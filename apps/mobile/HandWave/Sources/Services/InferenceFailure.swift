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
      "Inference cancelled."
    case .missingBaseURL:
      "Set the inference URL in HandWave.xcconfig."
    case .localhostOnDevice(let url):
      "\(url.absoluteString) points to this iPhone. Use your Mac's LAN or Tailscale URL."
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
