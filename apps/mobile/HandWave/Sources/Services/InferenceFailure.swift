import Foundation

enum InferenceFailure: Error, Equatable, LocalizedError, Sendable {
  case cancelled
  case missingBaseURL
  case localhostOnDevice(URL)
  case encodeRequestFailed(String)
  case requestFailed(URL, String)
  case badStatus(URL, Int)
  case decodeResponseFailed(URL, String)
  case unexpected(String)

  var errorDescription: String? {
    switch self {
    case .cancelled:
      nil
    case .missingBaseURL:
      #if DEBUG
      "Start development with pnpm dev, then rebuild this app."
      #else
      "This build has no verified inference service. Install a new release."
      #endif
    case .localhostOnDevice(let url):
      "\(url.absoluteString) points to this iPhone. Start pnpm dev and rebuild this app."
    case .encodeRequestFailed(let message):
      "Request setup failed: \(message)."
    case .requestFailed(let url, let message):
      "\(url.absoluteString) unreachable: \(message)."
    case .badStatus(let url, let status):
      "\(url.absoluteString): HTTP \(status)."
    case .decodeResponseFailed(let url, let message):
      "Bad response from \(url.absoluteString): \(message)."
    case .unexpected(let message):
      "Inference failed: \(message)."
    }
  }

}
