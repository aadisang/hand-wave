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

actor InferClient: InferAPI {
  private static let productionURL = URL(string: "https://handwave.sh")!
  private static let localURL = URL(string: "http://localhost:8000")!
  private static let protocolVersion = 1
  private static let retryDelay: TimeInterval = 5
  private static let handshakeTimeout: Duration = .seconds(15)
  private static let inferenceTimeout: Duration = .seconds(3)

  private let baseURLs: [URL]
  private let session: URLSession
  private let webSocketSession: URLSession
  private var webSocket: URLSessionWebSocketTask?
  private var webSocketURL: URL?
  private var sequence = 0
  private var lastSentTimestampMs: Int?
  private var needsResync = true
  private var webSocketRetryAfter = Date.distantPast

  init(
    baseURLs: [URL] = InferClient.configuredURLs,
    session: URLSession = InferClient.session,
    webSocketSession: URLSession = InferClient.webSocketSession
  ) {
    self.baseURLs = baseURLs
    self.session = session
    self.webSocketSession = webSocketSession
  }

  func warmConnection() async throws(InferenceFailure) {
    do {
      try await connectWebSocket()
    } catch {
      closeWebSocket()
      webSocketRetryAfter = Date().addingTimeInterval(Self.retryDelay)
      _ = try await sendHTTP(path: "/v1/health", method: "GET", body: nil)
    }
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    if Date() >= webSocketRetryAfter {
      do {
        return try await recognizeOverWebSocket(
          frames: frames,
          state: state,
          context: context,
          finalize: finalize
        )
      } catch {
        closeWebSocket()
        webSocketRetryAfter = Date().addingTimeInterval(Self.retryDelay)
        AppLog.inference.error(
          "WebSocket inference unavailable; using HTTP: \(error.localizedDescription, privacy: .private)"
        )
      }
    }
    return try await recognizeOverHTTP(
      frames: frames,
      state: state,
      context: context,
      finalize: finalize
    )
  }

  func resetStream() async {
    // Closing makes reset unconditional even when the network is already stale.
    // The next recognition request reconnects with the complete active window.
    closeWebSocket()
  }

  private func recognizeOverWebSocket(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    try await connectWebSocket()
    sequence &+= 1
    let delta = Self.unsentFrames(
      frames,
      after: lastSentTimestampMs,
      requiresResync: needsResync
    )
    let request = StreamRequest(
      type: "recognize",
      sequence: sequence,
      frames: delta.map(\.inferenceFeatures),
      state: needsResync ? state : nil,
      context: context,
      finalize: finalize
    )
    try await sendWebSocket(request)
    let response = try await receiveWebSocket(timeout: Self.inferenceTimeout)
    guard response.sequence == sequence else {
      throw .unexpected("Out-of-order inference stream response.")
    }
    guard response.protocolVersion == Self.protocolVersion else {
      throw .unexpected("Unsupported inference stream protocol.")
    }
    guard response.type == "result", let result = response.result else {
      throw .unexpected(response.detail ?? "Invalid inference stream response.")
    }
    if finalize {
      lastSentTimestampMs = nil
    } else if let timestamp = frames.last?.timestampMs {
      lastSentTimestampMs = timestamp
    }
    needsResync = false
    return result
  }

  private func recognizeOverHTTP(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    let request = InferenceRecognizeIn(
      frames: frames.map(\.inferenceFeatures),
      state: state,
      context: context,
      finalize: finalize
    )
    let body: Data
    do {
      body = try JSONEncoder().encode(request)
    } catch {
      throw .encodeRequestFailed(error.localizedDescription)
    }

    let (data, url) = try await sendHTTP(path: "/v1/recognize", method: "POST", body: body)
    do {
      return try JSONDecoder().decode(InferenceRecognizeOut.self, from: data)
    } catch {
      throw .decodeResponseFailed(url, error.localizedDescription)
    }
  }

  private func connectWebSocket() async throws(InferenceFailure) {
    if webSocket != nil { return }
    guard let baseURL = baseURLs.first(where: \.isUsableBackend),
      let url = baseURL.webSocketURL(path: "/v1/stream")
    else {
      throw .missingBaseURL
    }
    let task = webSocketSession.webSocketTask(with: url, protocols: ["handwave.v1"])
    webSocket = task
    webSocketURL = url
    lastSentTimestampMs = nil
    needsResync = true
    task.resume()

    sequence &+= 1
    try await sendWebSocket(StreamRequest(type: "ping", sequence: sequence))
    let response = try await receiveWebSocket(timeout: Self.handshakeTimeout)
    guard response.type == "pong", response.sequence == sequence,
      response.protocolVersion == Self.protocolVersion
    else {
      throw .unexpected("Inference stream handshake failed.")
    }
    AppLog.inference.notice("Inference WebSocket connected")
  }

  private func sendWebSocket(_ request: StreamRequest) async throws(InferenceFailure) {
    guard let webSocket, let url = webSocketURL else { throw .missingBaseURL }
    do {
      let data = try JSONEncoder().encode(request)
      guard let text = String(data: data, encoding: .utf8) else {
        throw InferenceFailure.encodeRequestFailed("WebSocket JSON was not UTF-8.")
      }
      try await webSocket.send(.string(text))
    } catch let failure as InferenceFailure {
      throw failure
    } catch {
      throw .requestFailed(url, error.localizedDescription)
    }
  }

  private func receiveWebSocket(
    timeout: Duration
  ) async throws(InferenceFailure) -> StreamResponse {
    guard let webSocket, let url = webSocketURL else { throw .missingBaseURL }
    let message: URLSessionWebSocketTask.Message
    do {
      message = try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
        group.addTask { try await webSocket.receive() }
        group.addTask {
          try await Task.sleep(for: timeout)
          webSocket.cancel(with: .goingAway, reason: nil)
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
      throw .requestFailed(url, error.localizedDescription)
    }

    let data: Data
    switch message {
    case .data(let value): data = value
    case .string(let value): data = Data(value.utf8)
    @unknown default: throw .unexpected("Unknown WebSocket message type.")
    }
    do {
      return try JSONDecoder().decode(StreamResponse.self, from: data)
    } catch {
      throw .decodeResponseFailed(url, error.localizedDescription)
    }
  }

  private func closeWebSocket() {
    webSocket?.cancel(with: .goingAway, reason: nil)
    webSocket = nil
    webSocketURL = nil
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

  private func sendHTTP(
    path: String,
    method: String,
    body: Data?
  ) async throws(InferenceFailure) -> (Data, URL) {
    guard !baseURLs.isEmpty else { throw .missingBaseURL }
    var lastFailure: InferenceFailure = .missingBaseURL

    for baseURL in baseURLs {
      guard baseURL.isUsableBackend else {
        lastFailure = .localhostOnDevice(baseURL)
        continue
      }

      let url = baseURL.appending(path: path)
      var request = URLRequest(url: url)
      request.httpMethod = method
      request.httpBody = body
      if body != nil {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }

      do {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
          let failure = InferenceFailure.badStatus(url, status)
          guard failure.canRetry else { throw failure }
          lastFailure = failure
          continue
        }
        return (data, url)
      } catch let failure as InferenceFailure {
        throw failure
      } catch {
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
          throw .cancelled
        }
        lastFailure = .requestFailed(url, error.localizedDescription)
      }
    }

    throw lastFailure
  }

  private static var configuredURLs: [URL] {
    let configured = (Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL") as? String)
      .flatMap { $0.contains("$(") ? nil : URL(string: $0) }
    #if DEBUG
      return [configured ?? localURL]
    #else
      return [configured ?? productionURL]
    #endif
  }

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 4
    configuration.timeoutIntervalForResource = 8
    return URLSession(configuration: configuration)
  }()

  private static let webSocketSession: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 4
    configuration.timeoutIntervalForResource = 3_600
    return URLSession(configuration: configuration)
  }()
}

private struct WebSocketResponseTimeout: Error {}

private struct StreamRequest: Encodable {
  let type: String
  let sequence: Int
  let protocolVersion: Int
  let frames: [InferenceLandmarkFrame]
  let state: InferenceRecognitionState?
  let context: InferenceRecognitionContext?
  let finalize: Bool

  init(
    type: String,
    sequence: Int,
    frames: [InferenceLandmarkFrame] = [],
    state: InferenceRecognitionState? = nil,
    context: InferenceRecognitionContext? = nil,
    finalize: Bool = false
  ) {
    self.type = type
    self.sequence = sequence
    self.protocolVersion = 1
    self.frames = frames
    self.state = state
    self.context = context
    self.finalize = finalize
  }

  enum CodingKeys: String, CodingKey {
    case type, sequence, frames, state, context, finalize
    case protocolVersion = "protocol"
  }
}

private struct StreamResponse: Decodable {
  let type: String
  let sequence: Int
  let protocolVersion: Int
  let result: InferenceRecognizeOut?
  let detail: String?

  enum CodingKeys: String, CodingKey {
    case type, sequence, result, detail
    case protocolVersion = "protocol"
  }
}

extension InferenceFailure {
  fileprivate var canRetry: Bool {
    switch self {
    case .requestFailed, .localhostOnDevice:
      true
    case .badStatus(_, let status):
      (500..<600).contains(status)
    case .cancelled, .missingBaseURL, .encodeRequestFailed, .decodeResponseFailed, .unexpected:
      false
    }
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
