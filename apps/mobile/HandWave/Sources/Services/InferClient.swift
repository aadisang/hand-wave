import Foundation

protocol InferAPI: Sendable {
  func warmConnection() async throws(InferenceFailure)
  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut
  func resetStream() async
}

extension InferAPI {
  func warmConnection() async throws(InferenceFailure) {}
  func resetStream() async {}
}

enum InferenceEndpoint: Equatable, Sendable {
  case remote
  case device
}

actor InferClient: InferAPI {
  private enum RecognitionInput: Sendable {
    case frames([LandmarkFrame])
    case emission(InferenceEmission)
  }

  private final class WebSocketOwner: @unchecked Sendable {
    let task: URLSessionWebSocketTask
    let url: URL

    init(task: URLSessionWebSocketTask, url: URL) {
      self.task = task
      self.url = url
    }
  }

  private static let productionURL = URL(string: "https://handwave.sh")!
  private static let deviceProductionURL = URL(
    string: "https://sinarck--decoder.modal.run"
  )!
  private static let localURL = URL(string: "http://localhost:8000")!
  private static let handshakeTimeout: Duration = .seconds(120)
  // Native model work keeps running after a client timeout. Leave enough time
  // for a queued decode instead of dropping a result that may still arrive.
  private static let inferenceTimeout: Duration = .seconds(30)

  private let baseURLs: [URL]
  private let webSocketSession: URLSession
  private var webSocketOwner: WebSocketOwner?
  private var connectionTask: Task<Result<WebSocketOwner, InferenceFailure>, Never>?
  private var connectionGeneration = 0
  private var isWebSocketReady = false
  private var sequence = 0
  private var lastSentTimestampMs: Int?
  private var needsResync = true
  private var warmupThrottle = WarmupThrottle()

  init(
    baseURLs: [URL]? = nil,
    endpoint: InferenceEndpoint = .remote,
    webSocketSession: URLSession = InferClient.webSocketSession
  ) {
    self.baseURLs = baseURLs ?? InferClient.configuredURLs(for: endpoint)
    self.webSocketSession = webSocketSession
  }

  func warmConnection() async throws(InferenceFailure) {
    let wait = warmupThrottle.remainingDelay(at: Date())
    if wait > 0 {
      do {
        try await Task.sleep(for: .seconds(wait))
      } catch {
        throw .cancelled
      }
    }
    do {
      try await connectWebSocket()
      warmupThrottle.clear()
    } catch {
      if error != .cancelled { warmupThrottle.recordFailure(at: Date()) }
      throw error
    }
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    do {
      return try await recognizeOverWebSocket(
        input: .frames(frames),
        state: state,
        context: context,
        finalize: finalize
      )
    } catch {
      if error != .cancelled { warmupThrottle.recordFailure(at: Date()) }
      AppLog.inference.error(
        "WebSocket inference failed: \(error.localizedDescription, privacy: .private)"
      )
      throw error
    }
  }

  func recognize(
    emission: InferenceEmission,
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    do {
      return try await recognizeOverWebSocket(
        input: .emission(emission),
        state: state,
        context: context,
        finalize: finalize
      )
    } catch {
      if error != .cancelled { warmupThrottle.recordFailure(at: Date()) }
      AppLog.inference.error(
        "WebSocket decoder failed: \(error.localizedDescription, privacy: .private)"
      )
      throw error
    }
  }

  func resetStream() async {
    // Closing makes reset unconditional even when the network is already stale.
    // The next recognition request reconnects with the complete active window.
    closeWebSocket()
    warmupThrottle.clear()
  }

  private func recognizeOverWebSocket(
    input: RecognitionInput,
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    let owner = try await connectWebSocket()
    do {
      if case .frames(let frames) = input,
        Self.cursorWasLost(
          in: frames,
          after: lastSentTimestampMs,
          requiresResync: needsResync
        )
      {
        sequence &+= 1
        try await resetRecognition(owner: owner)
      }
      sequence &+= 1
      let requestSequence = sequence
      switch input {
      case .frames(let frames):
        let delta = Self.unsentFrames(
          frames,
          after: lastSentTimestampMs,
          requiresResync: needsResync
        )
        if delta.isEmpty {
          guard finalize else {
            throw InferenceFailure.unexpected("Inference request had no new frames.")
          }
          try await sendWebSocket(
            InferenceStreamFinalizeRecognizeRequest(
              sequence: requestSequence,
              _protocol: 1,
              type: .recognize,
              state: needsResync ? state : nil,
              context: context,
              input: .finalize
            ),
            owner: owner
          )
        } else {
          try await sendWebSocket(
            InferenceStreamFrameRecognizeRequest(
              sequence: requestSequence,
              _protocol: 1,
              type: .recognize,
              state: needsResync ? state : nil,
              context: context,
              input: .frames,
              frames: delta.map(\.inferenceFeatures),
              finalize: finalize
            ),
            owner: owner
          )
        }
      case .emission(let emission):
        try await sendWebSocket(
          InferenceStreamEmissionRecognizeRequest(
            sequence: requestSequence,
            _protocol: 1,
            type: .recognize,
            state: needsResync ? state : nil,
            context: context,
            input: .emission,
            emission: emission,
            finalize: finalize
          ),
          owner: owner
        )
      }
      let response = try await receiveWebSocket(
        from: owner,
        timeout: Self.inferenceTimeout
      )
      guard response.sequence == requestSequence else {
        throw InferenceFailure.unexpected("Out-of-order inference stream response.")
      }
      let result: InferenceRecognizeOut
      switch response {
      case .result(let payload):
        result = payload.result
      case .error(let payload):
        throw InferenceFailure.unexpected(payload.detail)
      case .pong, .reset:
        throw InferenceFailure.unexpected("Invalid inference stream response.")
      }
      guard owner === webSocketOwner, isWebSocketReady else {
        throw InferenceFailure.cancelled
      }
      if finalize {
        lastSentTimestampMs = nil
      } else {
        switch input {
        case .frames(let frames):
          lastSentTimestampMs = frames.last?.timestampMs
        case .emission:
          lastSentTimestampMs = nil
        }
      }
      needsResync = false
      return result
    } catch let failure as InferenceFailure {
      discardWebSocket(owner)
      throw failure
    } catch {
      discardWebSocket(owner)
      throw .unexpected(error.localizedDescription)
    }
  }

  private func resetRecognition(owner: WebSocketOwner) async throws(InferenceFailure) {
    let requestSequence = sequence
    try await sendWebSocket(
      InferenceStreamResetRequest(
        sequence: requestSequence,
        _protocol: 1,
        type: .reset
      ),
      owner: owner
    )
    let response = try await receiveWebSocket(
      from: owner,
      timeout: Self.inferenceTimeout
    )
    guard case .reset = response, response.sequence == requestSequence else {
      throw .unexpected("Inference stream reset failed.")
    }
    lastSentTimestampMs = nil
    needsResync = true
  }

  @discardableResult
  private func connectWebSocket() async throws(InferenceFailure) -> WebSocketOwner {
    if isWebSocketReady, let webSocketOwner { return webSocketOwner }
    if let connectionTask {
      return try await finishConnection(connectionTask, generation: connectionGeneration)
    }

    connectionGeneration &+= 1
    let generation = connectionGeneration
    let task = Task { [weak self] () -> Result<WebSocketOwner, InferenceFailure> in
      guard let self else { return .failure(.cancelled) }
      do {
        return .success(try await self.openWebSocket(generation: generation))
      } catch let failure as InferenceFailure {
        return .failure(failure)
      } catch {
        return .failure(.unexpected(error.localizedDescription))
      }
    }
    connectionTask = task
    return try await finishConnection(task, generation: generation)
  }

  private func openWebSocket(generation: Int) async throws(InferenceFailure) -> WebSocketOwner {
    let url = try webSocketURL()
    let task = webSocketSession.webSocketTask(with: url, protocols: ["handwave.v1"])
    let owner = WebSocketOwner(task: task, url: url)
    guard generation == connectionGeneration else {
      task.cancel(with: .goingAway, reason: nil)
      throw .cancelled
    }
    webSocketOwner = owner
    lastSentTimestampMs = nil
    needsResync = true
    task.resume()

    do {
      sequence &+= 1
      let requestSequence = sequence
      try await sendWebSocket(
        InferenceStreamPingRequest(
          sequence: requestSequence,
          _protocol: 1,
          type: .ping
        ),
        owner: owner
      )
      let response = try await receiveWebSocket(
        from: owner,
        timeout: Self.handshakeTimeout
      )
      guard case .pong = response, response.sequence == requestSequence else {
        throw InferenceFailure.unexpected("Inference stream handshake failed.")
      }
      guard generation == connectionGeneration, owner === webSocketOwner else {
        throw InferenceFailure.cancelled
      }
      AppLog.inference.notice("Inference WebSocket connected")
      return owner
    } catch let failure as InferenceFailure {
      discardWebSocket(owner)
      throw failure
    } catch {
      discardWebSocket(owner)
      throw .unexpected(error.localizedDescription)
    }
  }

  private func finishConnection(
    _ task: Task<Result<WebSocketOwner, InferenceFailure>, Never>,
    generation: Int
  ) async throws(InferenceFailure) -> WebSocketOwner {
    let result = await task.value
    guard generation == connectionGeneration else { throw .cancelled }
    connectionTask = nil
    switch result {
    case .success(let owner):
      guard owner === webSocketOwner else { throw .cancelled }
      isWebSocketReady = true
      return owner
    case .failure(let failure):
      throw failure
    }
  }

  private func sendWebSocket<Request: Encodable>(
    _ request: Request,
    owner: WebSocketOwner
  ) async throws(InferenceFailure) {
    guard owner === webSocketOwner else { throw .cancelled }
    do {
      let data = try JSONEncoder().encode(request)
      guard let text = String(data: data, encoding: .utf8) else {
        throw InferenceFailure.encodeRequestFailed("WebSocket JSON was not UTF-8.")
      }
      try await owner.task.send(.string(text))
    } catch let failure as InferenceFailure {
      throw failure
    } catch {
      throw .requestFailed(owner.url, error.localizedDescription)
    }
  }

  private func receiveWebSocket(
    from owner: WebSocketOwner,
    timeout: Duration
  ) async throws(InferenceFailure) -> StreamResponsePayload {
    guard owner === webSocketOwner else { throw .cancelled }
    let message: URLSessionWebSocketTask.Message
    do {
      message = try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
        group.addTask { try await owner.task.receive() }
        group.addTask {
          try await Task.sleep(for: timeout)
          owner.task.cancel(with: .goingAway, reason: nil)
          throw WebSocketResponseTimeout()
        }
        guard let first = try await group.next() else {
          throw WebSocketResponseTimeout()
        }
        group.cancelAll()
        return first
      }
    } catch let failure as InferenceFailure {
      throw failure
    } catch {
      throw .requestFailed(owner.url, error.localizedDescription)
    }

    let data: Data
    switch message {
    case .data(let value): data = value
    case .string(let value): data = Data(value.utf8)
    @unknown default: throw .unexpected("Unknown WebSocket message type.")
    }
    do {
      return try StreamResponsePayload.decode(from: data)
    } catch {
      throw .decodeResponseFailed(owner.url, error.localizedDescription)
    }
  }

  private func closeWebSocket() {
    connectionGeneration &+= 1
    connectionTask?.cancel()
    connectionTask = nil
    isWebSocketReady = false
    webSocketOwner?.task.cancel(with: .goingAway, reason: nil)
    webSocketOwner = nil
    lastSentTimestampMs = nil
    needsResync = true
  }

  private func discardWebSocket(_ owner: WebSocketOwner) {
    owner.task.cancel(with: .goingAway, reason: nil)
    guard owner === webSocketOwner else { return }
    isWebSocketReady = false
    webSocketOwner = nil
    lastSentTimestampMs = nil
    needsResync = true
  }

  static func unsentFrames(
    _ frames: [LandmarkFrame],
    after timestampMs: Int?,
    requiresResync: Bool
  ) -> [LandmarkFrame] {
    guard !requiresResync, let timestampMs else { return frames }
    return frames.filter { $0.timestampMs > timestampMs }
  }

  static func cursorWasLost(
    in frames: [LandmarkFrame],
    after timestampMs: Int?,
    requiresResync: Bool
  ) -> Bool {
    guard !requiresResync, let timestampMs else { return false }
    return !frames.contains { $0.timestampMs == timestampMs }
  }

  private func webSocketURL() throws(InferenceFailure) -> URL {
    for baseURL in baseURLs where baseURL.isUsableBackend {
      if let url = baseURL.webSocketURL(path: "/v1/stream") {
        return url
      }
    }
    if let localURL = baseURLs.first(where: { !$0.isUsableBackend }) {
      throw .localhostOnDevice(localURL)
    }
    throw .missingBaseURL
  }

  private static func configuredURLs(for endpoint: InferenceEndpoint) -> [URL] {
    let key = endpoint == .remote ? "HandWaveInferenceURL" : "HandWaveDeviceInferenceURL"
    let fallback = endpoint == .remote ? productionURL : deviceProductionURL
    let configured = (Bundle.main.object(forInfoDictionaryKey: key) as? String)
      .flatMap { $0.contains("$(") ? nil : URL(string: $0) }
    #if DEBUG
    return [configured ?? localURL]
    #else
    return [configured ?? fallback]
    #endif
  }

  private static let webSocketSession: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 4
    configuration.timeoutIntervalForResource = 3_600
    return URLSession(configuration: configuration)
  }()
}

private struct WebSocketResponseTimeout: Error {}

/// Failures anywhere on the stream are recorded here, but the delay is only
/// enforced when warming: `Recognizer` retries warmup from its frame loop, and
/// this throttle is what keeps that loop from hammering an unhealthy backend.
struct WarmupThrottle: Sendable {
  private static let retryDelay: TimeInterval = 5
  private(set) var retryAfter = Date.distantPast

  mutating func recordFailure(at date: Date) {
    retryAfter = date.addingTimeInterval(Self.retryDelay)
  }

  mutating func clear() {
    retryAfter = .distantPast
  }

  func remainingDelay(at date: Date) -> TimeInterval {
    max(0, retryAfter.timeIntervalSince(date))
  }
}

extension URL {
  fileprivate var isUsableBackend: Bool {
    guard let host = host(percentEncoded: false)?.lowercased() else { return true }
    let loopback = host == "localhost" || host == "::1" || host.hasPrefix("127.")
    #if targetEnvironment(simulator)
    return true
    #else
    return !loopback
    #endif
  }

  func webSocketURL(path: String) -> URL? {
    guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
      return nil
    }
    switch components.scheme?.lowercased() {
    case "http": components.scheme = "ws"
    case "https": components.scheme = "wss"
    default: return nil
    }
    components.path = path
    return components.url
  }
}
