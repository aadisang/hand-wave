import Foundation

protocol InferAPI: Sendable {
  func warmConnection() async throws(InferenceFailure)

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut
}

extension InferAPI {
  func warmConnection() async throws(InferenceFailure) {}
}

struct InferClient: Sendable {
  private let baseURLs: [URL]
  private let session: URLSession
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  var endpointDescription: String {
    guard !baseURLs.isEmpty else { return "not configured" }
    return baseURLs.map(\.absoluteString).joined(separator: ", ")
  }

  init(
    baseURLs: [URL] = InferClient.defaultBaseURLs(),
    session: URLSession = InferClient.defaultSession()
  ) {
    self.baseURLs = baseURLs
    self.session = session
  }

  init(
    baseURL: URL?,
    session: URLSession = InferClient.defaultSession()
  ) {
    self.init(baseURLs: baseURL.map { [$0] } ?? [], session: session)
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool = false
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
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

  func warmConnection() async throws(InferenceFailure) {
    try await withFirstAvailableEndpoint { baseURL in
      var request = URLRequest(url: baseURL)
      request.httpMethod = "HEAD"

      do {
        _ = try await session.data(for: request)
        return .success(())
      } catch {
        return .failure(.requestFailed(baseURL, FailureDescriptions.describe(error)))
      }
    }
  }

  private func post<Response: Decodable & Sendable, Body: Encodable>(
    path: String,
    body: Body
  ) async throws(InferenceFailure) -> Response {
    try await withFirstAvailableEndpoint { baseURL in
      let url = baseURL.appending(path: path)
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      do {
        request.httpBody = try encoder.encode(body)
      } catch {
        return .failure(.encodeRequestFailed(url, FailureDescriptions.describe(error)))
      }

      let data: Data
      let response: URLResponse
      do {
        (data, response) = try await session.data(for: request)
      } catch {
        return .failure(.requestFailed(url, FailureDescriptions.describe(error)))
      }

      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(status) else {
        return .failure(.badStatus(url, status))
      }
      do {
        return .success(try decoder.decode(Response.self, from: data))
      } catch {
        return .failure(.decodeResponseFailed(url, FailureDescriptions.describe(error)))
      }
    }
  }

  private func withFirstAvailableEndpoint<Response: Sendable>(
    _ operation: (URL) async -> Result<Response, InferenceFailure>
  ) async throws(InferenceFailure) -> Response {
    guard !baseURLs.isEmpty else {
      throw .missingBaseURL
    }

    var lastFailure: InferenceFailure?
    for baseURL in baseURLs {
      guard baseURL.isUsableFromCurrentDevice else {
        lastFailure = .localhostOnDevice(baseURL)
        continue
      }

      switch await operation(baseURL) {
      case .success(let response):
        return response
      case .failure(let failure):
        lastFailure = failure
        guard failure.canTryNextEndpoint else { throw failure }
      }
    }

    throw lastFailure ?? .missingBaseURL
  }

  private static func defaultBaseURLs() -> [URL] {
    let urls = urlsFromInfoDictionaryValue("HandWaveInferenceURLs")
    if !urls.isEmpty { return urls }
    return urlsFromInfoDictionaryValue("HandWaveInferenceURL")
  }

  private static func urlsFromInfoDictionaryValue(_ key: String) -> [URL] {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
      return []
    }

    return value.split { ",;\n".contains($0) }
      .compactMap { rawValue -> URL? in
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return URL(string: trimmed)
      }
  }

  private static func defaultSession() -> URLSession {
    let configuration = URLSessionConfiguration.default
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 4
    configuration.timeoutIntervalForResource = 8
    return URLSession(configuration: configuration)
  }
}

extension InferClient: InferAPI {}

extension InferenceFailure {
  fileprivate var canTryNextEndpoint: Bool {
    switch self {
    case .requestFailed, .localhostOnDevice:
      true
    case .badStatus(_, let status):
      (500..<600).contains(status)
    case .missingBaseURL, .encodeRequestFailed, .decodeResponseFailed, .unexpected:
      false
    }
  }
}

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
