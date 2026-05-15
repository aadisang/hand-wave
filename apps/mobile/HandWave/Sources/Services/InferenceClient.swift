import Foundation

struct InferenceClient: Sendable {
  enum ClientError: Error, LocalizedError {
    case missingBaseURL
    case badStatus(URL, Int)
    case requestFailed(URL, String)

    var errorDescription: String? {
      switch self {
      case .missingBaseURL:
        "Set HANDWAVE_INFERENCE_URL in HandWave.xcconfig."
      case .badStatus(let url, let status):
        "\(url.absoluteString) returned HTTP \(status)."
      case .requestFailed(let url, let message):
        "\(url.absoluteString) failed: \(message). If this is a 192.168.x.x URL, allow Local Network access for Hand Wave in iOS Settings and confirm the phone is on the same network as the Mac."
      }
    }
  }

  private let baseURL: URL
  private let session: URLSession
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  var endpointDescription: String {
    baseURL.absoluteString
  }

  init(
    baseURL: URL = InferenceClient.defaultBaseURL(),
    session: URLSession = InferenceClient.defaultSession()
  ) {
    self.baseURL = baseURL
    self.session = session
  }

  func createSession() async throws -> String {
    struct Request: Encodable {
      let maxWindowFrames = 128
      let minStableFrames = 2

      enum CodingKeys: String, CodingKey {
        case maxWindowFrames = "max_window_frames"
        case minStableFrames = "min_stable_frames"
      }
    }
    struct Response: Decodable {
      let sessionId: String

      enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
      }
    }

    let response: Response = try await post(
      path: "/v1/sessions",
      body: Request()
    )
    return response.sessionId
  }

  func appendFrames(
    sessionId: String,
    frames: [LandmarkFrame]
  ) async throws -> StreamPredictionResponse {
    struct Request: Encodable {
      let frames: [LandmarkFrame]
    }

    return try await post(
      path: "/v1/sessions/\(sessionId)/frames",
      body: Request(frames: frames)
    )
  }

  func resetSession(sessionId: String) async throws -> InferenceResetResponse {
    try await post(path: "/v1/sessions/\(sessionId)/reset", body: EmptyBody())
  }

  func deleteSession(sessionId: String) async {
    var request = URLRequest(url: baseURL.appending(path: "/v1/sessions/\(sessionId)"))
    request.httpMethod = "DELETE"
    _ = try? await session.data(for: request)
  }

  private func post<Response: Decodable, Body: Encodable>(
    path: String,
    body: Body
  ) async throws -> Response {
    let url = baseURL.appending(path: path)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try encoder.encode(body)

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw ClientError.requestFailed(url, error.localizedDescription)
    }

    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw ClientError.badStatus(url, status)
    }
    return try decoder.decode(Response.self, from: data)
  }

  private static func defaultBaseURL() -> URL {
    if let value = Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL")
      as? String,
      let url = URL(string: value),
      !value.isEmpty
    {
      return url
    }
    return URL(string: "http://localhost:8000")!
  }

  private static func defaultSession() -> URLSession {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 3
    configuration.timeoutIntervalForResource = 6
    return URLSession(configuration: configuration)
  }
}

private struct EmptyBody: Encodable {}
