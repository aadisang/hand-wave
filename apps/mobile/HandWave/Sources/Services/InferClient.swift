import Foundation

protocol InferAPI: Sendable {
  func warmConnection() async throws

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws -> InferenceRecognizeOut
}

extension InferAPI {
  func warmConnection() async throws {}
}

struct InferClient: Sendable {
  enum ClientError: Error, LocalizedError {
    case missingBaseURL
    case localhostOnDevice(URL)
    case badStatus(URL, Int)
    case requestFailed(URL, String)

    var errorDescription: String? {
      switch self {
      case .missingBaseURL:
        "Set HANDWAVE_INFERENCE_URL in HandWave.xcconfig. On a physical iPhone, localhost points to the phone, not your Mac."
      case .localhostOnDevice(let url):
        "\(url.absoluteString) points to this iPhone, not your Mac. Use the deployed Modal URL or your Mac's Wi-Fi IP address."
      case .badStatus(let url, let status):
        "\(url.absoluteString) returned HTTP \(status)."
      case .requestFailed(let url, let message):
        "\(url.absoluteString) failed: \(message). If this is a 192.168.x.x URL, allow Local Network access for Hand Wave in iOS Settings and confirm the phone is on the same network as the Mac."
      }
    }
  }

  private let baseURL: URL?
  private let session: URLSession
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  var endpointDescription: String {
    baseURL?.absoluteString ?? "not configured"
  }

  init(
    baseURL: URL? = InferClient.defaultBaseURL(),
    session: URLSession = InferClient.defaultSession()
  ) {
    self.baseURL = baseURL
    self.session = session
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool = false
  ) async throws -> InferenceRecognizeOut {
    return try await post(
      path: "/v1/recognize",
      body: InferenceRecognizeIn(
        frames: frames.map(\.inferenceFeatures),
        state: state,
        context: context,
        finalize: finalize
      )
    )
  }

  func warmConnection() async throws {
    guard let baseURL else {
      throw ClientError.missingBaseURL
    }

    guard baseURL.isUsableFromCurrentDevice else {
      throw ClientError.localhostOnDevice(baseURL)
    }

    var request = URLRequest(url: baseURL)
    request.httpMethod = "HEAD"

    do {
      _ = try await session.data(for: request)
    } catch {
      throw ClientError.requestFailed(baseURL, error.localizedDescription)
    }
  }

  private func post<Response: Decodable, Body: Encodable>(
    path: String,
    body: Body
  ) async throws -> Response {
    guard let baseURL else {
      throw ClientError.missingBaseURL
    }

    guard baseURL.isUsableFromCurrentDevice else {
      throw ClientError.localhostOnDevice(baseURL)
    }

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

  private static func defaultBaseURL() -> URL? {
    guard
      let value = Bundle.main.object(forInfoDictionaryKey: "HandWaveInferenceURL")
        as? String
    else { return nil }

    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
    return URL(string: trimmed)
  }

  private static func defaultSession() -> URLSession {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    return URLSession(configuration: configuration)
  }
}

extension InferClient: InferAPI {}

extension URL {
  fileprivate var isUsableFromCurrentDevice: Bool {
    !isLoopbackHost || Self.allowsLoopbackBackend
  }

  private var isLoopbackHost: Bool {
    guard let host = host(percentEncoded: false)?.lowercased() else { return false }
    return host == "localhost" || host == "::1" || host.hasPrefix("127.")
  }

  private static var allowsLoopbackBackend: Bool {
    #if targetEnvironment(simulator)
    true
    #else
    false
    #endif
  }
}
