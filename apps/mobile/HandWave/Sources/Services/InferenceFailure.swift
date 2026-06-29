import Foundation
import MWDATCore

enum InferenceFailure: Error, Equatable, LocalizedError, Sendable {
  case missingBaseURL
  case localhostOnDevice(URL)
  case encodeRequestFailed(URL, String)
  case requestFailed(URL, String)
  case badStatus(URL, Int)
  case decodeResponseFailed(URL, String)
  case unexpected(String)

  var errorDescription: String? {
    switch self {
    case .missingBaseURL:
      "Set the inference URL in HandWave.xcconfig."
    case .localhostOnDevice(let url):
      "\(url.absoluteString) points to this iPhone. Use your Mac's LAN or Tailscale URL."
    case .encodeRequestFailed(let url, let message):
      "Request setup failed for \(url.absoluteString): \(message)."
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

  var statusDescription: String {
    switch self {
    case .missingBaseURL:
      "No inference URL"
    case .localhostOnDevice:
      "URL points here"
    case .encodeRequestFailed:
      "Request failed"
    case .requestFailed:
      "Backend unreachable"
    case .badStatus(_, let status):
      "Backend HTTP \(status)"
    case .decodeResponseFailed:
      "Bad backend response"
    case .unexpected:
      "Inference failed"
    }
  }
}

enum WearablesFailure: Error, LocalizedError, Sendable {
  case connection(String)
  case camera(String)
  case callback(String)

  var errorDescription: String? {
    switch self {
    case .connection(let message), .camera(let message), .callback(let message):
      message
    }
  }
}

enum StreamFailure: Error, LocalizedError, Sendable {
  case noGlasses
  case session(String)
  case camera(String)
  case recognition(String)

  static func ended(_ error: DeviceSessionError?) -> Self {
    .session(error.map(message) ?? "Glasses stopped before streaming. Keep them open nearby.")
  }

  static func stopped(_ error: DeviceSessionError) -> Self {
    .session(message(error))
  }

  var errorDescription: String? {
    switch self {
    case .noGlasses:
      "No glasses ready."
    case .session(let message), .camera(let message), .recognition(let message):
      message
    }
  }

  private static func message(_ error: DeviceSessionError) -> String {
    switch error {
    case .noEligibleDevice:
      "No glasses ready. Open or wear them nearby."
    case .sessionAlreadyStopped:
      "Session already stopped. Try again."
    case .sessionAlreadyExists:
      "Another session is active."
    case .sessionIdle:
      "Session stayed idle. Reopen glasses."
    case .capabilityAlreadyActive:
      "Camera already in use."
    case .capabilityNotFound:
      "Camera unavailable. Try again."
    case .unexpectedError(let description):
      if description.localizedCaseInsensitiveContains("session ended by device") {
        "Glasses ended the session. Keep them open and worn."
      } else if description.localizedCaseInsensitiveContains("device unavailable") {
        "Device unavailable. Open or wear your glasses nearby."
      } else {
        description
      }
    case .thermalCritical:
      "Glasses too warm."
    case .thermalEmergency:
      "Glasses overheated."
    case .peakPowerShutdown:
      "Glasses need charging."
    case .batteryCritical:
      "Glasses battery low."
    case .datAppOnTheGlassesUpdateRequired:
      "Update DAT in Meta AI."
    case .dwaUnavailable:
      "DAT unavailable. Reconnect in Meta AI."
    }
  }
}

extension DeviceSessionError {
  var stopsSession: Bool {
    switch self {
    case .thermalCritical,
      .thermalEmergency,
      .peakPowerShutdown,
      .batteryCritical,
      .datAppOnTheGlassesUpdateRequired:
      true
    case .noEligibleDevice,
      .sessionAlreadyStopped,
      .sessionAlreadyExists,
      .sessionIdle,
      .capabilityAlreadyActive,
      .capabilityNotFound,
      .unexpectedError,
      .dwaUnavailable:
      false
    }
  }
}
