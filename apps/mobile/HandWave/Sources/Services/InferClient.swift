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

struct InferClient: InferAPI, Sendable {
  private static let productionURL = URL(string: "https://handwave.sh")!
  private static let localURL = URL(string: "http://localhost:8000")!

  private let baseURLs: [URL]
  private let session: URLSession

  init(
    baseURLs: [URL] = Self.configuredURLs,
    session: URLSession = Self.session
  ) {
    self.baseURLs = baseURLs
    self.session = session
  }

  func warmConnection() async throws(InferenceFailure) {
    _ = try await send(path: "/v1/health", method: "GET", body: nil)
  }

  func recognize(
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

    let (data, url) = try await send(path: "/v1/recognize", method: "POST", body: body)
    do {
      return try JSONDecoder().decode(InferenceRecognizeOut.self, from: data)
    } catch {
      throw .decodeResponseFailed(url, error.localizedDescription)
    }
  }

  private func send(
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
}
