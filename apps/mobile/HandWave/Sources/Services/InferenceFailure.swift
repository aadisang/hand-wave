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

enum WearablesFailure: Error, Equatable, LocalizedError, Sendable {
  case registrationFailed(String)
  case unregistrationFailed(String)
  case cameraNeedsRegistration
  case cameraPermissionFailed(String)
  case callbackFailed(String)

  static func registrationFailed(_ error: any Error) -> Self {
    .registrationFailed(FailureDescriptions.describe(error))
  }

  static func unregistrationFailed(_ error: any Error) -> Self {
    .unregistrationFailed(FailureDescriptions.describe(error))
  }

  static func cameraPermissionFailed(_ error: any Error) -> Self {
    .cameraPermissionFailed(FailureDescriptions.describe(error))
  }

  static func callbackFailed(_ error: any Error) -> Self {
    .callbackFailed(FailureDescriptions.describe(error))
  }

  var errorDescription: String? {
    switch self {
    case .registrationFailed(let message):
      "Connection failed: \(message)"
    case .unregistrationFailed(let message):
      "Disconnect failed: \(message)"
    case .cameraNeedsRegistration:
      "Connect glasses first."
    case .cameraPermissionFailed(let message):
      "Camera access failed: \(message)"
    case .callbackFailed(let message):
      "Meta AI callback failed: \(message)"
    }
  }
}

enum StreamFailure: Error, Equatable, LocalizedError, Sendable {
  case noActiveDevice
  case sessionStartFailed(String)
  case sessionEndedEarly(String?)
  case sessionRuntimeFailed(String)
  case streamConfigRejected
  case streamOpenFailed(String)
  case streamRuntimeFailed(String)
  case recognitionStartFailed(String)
  case recognitionFailed(String)

  static func sessionStartFailed(_ error: any Error) -> Self {
    .sessionStartFailed(FailureDescriptions.describe(error))
  }

  static func sessionEndedEarly(_ error: DeviceSessionError?) -> Self {
    .sessionEndedEarly(error.map(Self.describeSessionError))
  }

  static func sessionRuntimeFailed(_ error: DeviceSessionError) -> Self {
    .sessionRuntimeFailed(describeSessionError(error))
  }

  static func streamOpenFailed(_ error: any Error) -> Self {
    .streamOpenFailed(FailureDescriptions.describe(error))
  }

  static func recognitionStartFailed(_ error: any Error) -> Self {
    .recognitionStartFailed(FailureDescriptions.describe(error))
  }

  static func recognitionFailed(_ error: any Error) -> Self {
    .recognitionFailed(FailureDescriptions.describe(error))
  }

  var errorDescription: String? {
    switch self {
    case .noActiveDevice:
      "No glasses ready."
    case .sessionStartFailed(let message):
      "Session failed: \(message)"
    case .sessionEndedEarly(let message):
      if let message {
        "Glasses stopped before streaming. \(message)"
      } else {
        "Glasses stopped before streaming. Try again."
      }
    case .sessionRuntimeFailed(let message):
      "Session stopped: \(message)"
    case .streamConfigRejected:
      "Stream settings rejected."
    case .streamOpenFailed(let message):
      "Stream failed: \(message)"
    case .streamRuntimeFailed(let message):
      "Stream failed: \(message)"
    case .recognitionStartFailed(let message):
      "Recognition failed: \(message)"
    case .recognitionFailed(let message):
      "Recognition failed: \(message)"
    }
  }

  private static func describeSessionError(_ error: DeviceSessionError) -> String {
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
      } else {
        "Unexpected session error: \(description)"
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
