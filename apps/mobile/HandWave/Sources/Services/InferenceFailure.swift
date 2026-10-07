import Foundation

/// Descriptions are shown to users. Transport, encoding, and decoding details
/// stay in the associated values, which `InferClient` logs.
enum InferenceFailure: Error, Equatable, LocalizedError, Sendable {
  case cancelled
  case timedOut
  case missingBaseURL
  case localhostOnDevice(URL)
  case encodeRequestFailed(String)
  case requestFailed(String)
  case decodeResponseFailed(String)
  case unexpected(String)

  var errorDescription: String? {
    switch self {
    case .cancelled:
      "Inference was cancelled."
    case .timedOut:
      "The inference service did not respond in time. Check your connection and try again."
    case .missingBaseURL:
      #if DEBUG
      "Start development with pnpm dev, then rebuild this app."
      #else
      "This build has no verified inference service. Install a new release."
      #endif
    case .localhostOnDevice(let url):
      "\(url.absoluteString) points to this iPhone. Start pnpm dev and rebuild this app."
    case .encodeRequestFailed:
      "The inference request could not be prepared."
    case .requestFailed:
      "The inference service is unreachable. Check your connection and try again."
    case .decodeResponseFailed:
      "The inference service sent an invalid response."
    case .unexpected(let message):
      "Inference failed: \(message)"
    }
  }
}
