import Foundation

actor InferClient {
  private static let handshakeTimeout: Duration = .seconds(120)
  // Native model work keeps running after a client timeout. Leave enough time
  // for a queued decode instead of dropping a result that may still arrive.
  private static let inferenceTimeout: Duration = .seconds(30)
  private static let retryDelay: TimeInterval = 5

  private let baseURL = InferClient.configuredURL
  private var webSocket: URLSessionWebSocketTask?
  private var connectionTask: Task<Result<URLSessionWebSocketTask, InferenceFailure>, Never>?
  private var connectionGeneration = 0
  private var isWebSocketReady = false
  private var sequence = 0
  private var lastSentTimestampMs: Int?
  private var needsResync = true
  /// Failures anywhere on the stream are recorded here, but the delay is only
  /// enforced when warming: `Recognizer` retries warmup from its frame loop, and
  /// this delay is what keeps that loop from hammering an unhealthy backend.
  private var retryAfter = Date.distantPast

  func warmConnection() async throws(InferenceFailure) {
    let wait = retryAfter.timeIntervalSinceNow
    if wait > 0 {
      do {
        try await Task.sleep(for: .seconds(wait))
      } catch {
        throw .cancelled
      }
    }
    do {
      try await connectWebSocket()
      retryAfter = .distantPast
    } catch {
      recordFailure(error)
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
        frames: frames,
        state: state,
        context: context,
        finalize: finalize
      )
    } catch {
      recordFailure(error)
      throw error
    }
  }

  func resetStream() async {
    // Closing makes reset unconditional even when the network is already stale.
    // The next recognition request reconnects with the complete active window.
    closeWebSocket()
    retryAfter = .distantPast
  }

  private func recordFailure(_ failure: InferenceFailure) {
    guard failure != .cancelled else { return }
    retryAfter = Date().addingTimeInterval(Self.retryDelay)
    AppLog.inference.error(
      "WebSocket inference failed: \(String(describing: failure), privacy: .private)"
    )
  }

  private func recognizeOverWebSocket(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    let task = try await connectWebSocket()
    do {
      if Self.cursorWasLost(
        in: frames,
        after: lastSentTimestampMs,
        requiresResync: needsResync
      ) {
        sequence &+= 1
        try await resetRecognition(on: task)
      }
      sequence &+= 1
      let requestSequence = sequence
      let delta = Self.unsentFrames(
        frames,
        after: lastSentTimestampMs,
        requiresResync: needsResync
      )
      let request = InferenceStreamRecognizeRequest(
        sequence: requestSequence,
        _protocol: 1,
        type: .recognize,
        frames: delta.map(\.inferenceFeatures),
        state: needsResync ? state : nil,
        context: context,
        finalize: finalize
      )
      let response = try await exchange(request, on: task, timeout: Self.inferenceTimeout)
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
      guard task === webSocket, isWebSocketReady else {
        throw InferenceFailure.cancelled
      }
      if finalize {
        lastSentTimestampMs = nil
      } else if let timestamp = frames.last?.timestampMs {
        lastSentTimestampMs = timestamp
      }
      needsResync = false
      return result
    } catch let failure as InferenceFailure {
      discardWebSocket(task)
      throw failure
    } catch {
      discardWebSocket(task)
      throw .unexpected(error.localizedDescription)
    }
  }

  private func resetRecognition(on task: URLSessionWebSocketTask) async throws(InferenceFailure) {
    let requestSequence = sequence
    let response = try await exchange(
      InferenceStreamResetRequest(
        sequence: requestSequence,
        _protocol: 1,
        type: .reset
      ),
      on: task,
      timeout: Self.inferenceTimeout
    )
    guard case .reset = response, response.sequence == requestSequence else {
      throw .unexpected("Inference stream reset failed.")
    }
    lastSentTimestampMs = nil
    needsResync = true
  }

  @discardableResult
  private func connectWebSocket() async throws(InferenceFailure) -> URLSessionWebSocketTask {
    if isWebSocketReady, let webSocket { return webSocket }
    if let connectionTask {
      return try await finishConnection(connectionTask, generation: connectionGeneration)
    }

    connectionGeneration &+= 1
    let generation = connectionGeneration
    let task = Task { [weak self] () -> Result<URLSessionWebSocketTask, InferenceFailure> in
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

  private func openWebSocket(
    generation: Int
  ) async throws(InferenceFailure) -> URLSessionWebSocketTask {
    let url = try webSocketURL()
    let task = Self.webSocketSession.webSocketTask(with: url, protocols: ["handwave.v1"])
    guard generation == connectionGeneration else {
      task.cancel(with: .goingAway, reason: nil)
      throw .cancelled
    }
    webSocket = task
    lastSentTimestampMs = nil
    needsResync = true
    task.resume()

    do {
      sequence &+= 1
      let requestSequence = sequence
      let response = try await exchange(
        InferenceStreamPingRequest(
          sequence: requestSequence,
          _protocol: 1,
          type: .ping
        ),
        on: task,
        timeout: Self.handshakeTimeout
      )
      guard case .pong = response, response.sequence == requestSequence else {
        throw InferenceFailure.unexpected("Inference stream handshake failed.")
      }
      guard generation == connectionGeneration, task === webSocket else {
        throw InferenceFailure.cancelled
      }
      AppLog.inference.notice("Inference WebSocket connected")
      return task
    } catch let failure as InferenceFailure {
      discardWebSocket(task)
      throw failure
    } catch {
      discardWebSocket(task)
      throw .unexpected(error.localizedDescription)
    }
  }

  private func finishConnection(
    _ task: Task<Result<URLSessionWebSocketTask, InferenceFailure>, Never>,
    generation: Int
  ) async throws(InferenceFailure) -> URLSessionWebSocketTask {
    let result = await task.value
    guard generation == connectionGeneration else { throw .cancelled }
    connectionTask = nil
    switch result {
    case .success(let socket):
      guard socket === webSocket else { throw .cancelled }
      isWebSocketReady = true
      return socket
    case .failure(let failure):
      throw failure
    }
  }

  /// Sends one request and reads its response under a single deadline, so a
  /// stop or timeout also releases a send that is blocked on a stalled socket.
  private func exchange(
    _ request: some Encodable,
    on task: URLSessionWebSocketTask,
    timeout: Duration
  ) async throws(InferenceFailure) -> StreamResponsePayload {
    guard task === webSocket else { throw .cancelled }
    let text: String
    do {
      text = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
    } catch {
      throw .encodeRequestFailed(error.localizedDescription)
    }
    do {
      let response = try await withWebSocketDeadline(
        timeout: timeout,
        cancel: { task.cancel(with: .goingAway, reason: nil) },
        operation: {
          try await task.send(.string(text))
          let message = try await task.receive()
          return try Self.decode(message)
        }
      )
      guard task === webSocket else { throw InferenceFailure.cancelled }
      return response
    } catch let failure as InferenceFailure {
      throw failure
    } catch {
      throw .requestFailed(error.localizedDescription)
    }
  }

  private static func decode(
    _ message: URLSessionWebSocketTask.Message
  ) throws(InferenceFailure) -> StreamResponsePayload {
    let data: Data
    switch message {
    case .data(let value): data = value
    case .string(let value): data = Data(value.utf8)
    @unknown default: throw .unexpected("Unknown WebSocket message type.")
    }
    do {
      return try StreamResponsePayload.decode(from: data)
    } catch {
      throw .decodeResponseFailed(error.localizedDescription)
    }
  }

  private func closeWebSocket() {
    connectionGeneration &+= 1
    connectionTask?.cancel()
    connectionTask = nil
    isWebSocketReady = false
    webSocket?.cancel(with: .goingAway, reason: nil)
    webSocket = nil
    lastSentTimestampMs = nil
    needsResync = true
  }

  private func discardWebSocket(_ task: URLSessionWebSocketTask) {
    task.cancel(with: .goingAway, reason: nil)
    guard task === webSocket else { return }
    isWebSocketReady = false
    webSocket = nil
    lastSentTimestampMs = nil
    needsResync = true
  }

  private static func unsentFrames(
    _ frames: [LandmarkFrame],
    after timestampMs: Int?,
    requiresResync: Bool
  ) -> [LandmarkFrame] {
    guard !requiresResync, let timestampMs else { return frames }
    return frames.filter { $0.timestampMs > timestampMs }
  }

  private static func cursorWasLost(
    in frames: [LandmarkFrame],
    after timestampMs: Int?,
    requiresResync: Bool
  ) -> Bool {
    guard !requiresResync, let timestampMs else { return false }
    return !frames.contains { $0.timestampMs == timestampMs }
  }

  private func webSocketURL() throws(InferenceFailure) -> URL {
    guard let baseURL else { throw .missingBaseURL }
    guard baseURL.isUsableBackend else { throw .localhostOnDevice(baseURL) }
    guard let url = baseURL.webSocketURL(path: "/v1/stream") else { throw .missingBaseURL }
    return url
  }

  private static var configuredURL: URL? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL") as? String,
      let url = URL(string: value), url.host() != nil
    else { return nil }
    return url
  }

  private static let webSocketSession: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = false
    configuration.timeoutIntervalForRequest = 120
    configuration.timeoutIntervalForResource = 3_600
    return URLSession(configuration: configuration)
  }()
}

/// Covers connection establishment as well as I/O. Cancelling a task group alone
/// does not unblock URLSession WebSocket I/O; close the socket on timeout or stop.
func withWebSocketDeadline<Value: Sendable>(
  timeout: Duration,
  cancel: @escaping @Sendable () -> Void,
  operation: @escaping @Sendable () async throws -> Value
) async throws -> Value {
  try await withTaskCancellationHandler {
    try await withThrowingTaskGroup(of: Value.self) { group in
      defer { group.cancelAll() }
      group.addTask { try await operation() }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw InferenceFailure.timedOut
      }
      do {
        guard let result = try await group.next() else { throw CancellationError() }
        try Task.checkCancellation()
        return result
      } catch {
        // Select the failure before closing the socket, since closing it can
        // release pending I/O with a different transport error.
        cancel()
        if Task.isCancelled { throw InferenceFailure.cancelled }
        throw error
      }
    }
  } onCancel: {
    cancel()
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

  fileprivate func webSocketURL(path: String) -> URL? {
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
