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
      "Set HANDWAVE_INFERENCE_URL or HANDWAVE_INFERENCE_URLS in HandWave.xcconfig. On a physical iPhone, localhost points to the phone, not your Mac."
    case .localhostOnDevice(let url):
      "\(url.absoluteString) points to this iPhone, not your Mac. Use the deployed Modal URL, your Mac's Wi-Fi IP address, or the Mac's Tailscale MagicDNS URL."
    case .encodeRequestFailed(let url, let message):
      "Couldn't encode the request for \(url.absoluteString): \(message)."
    case .requestFailed(let url, let message):
      "\(url.absoluteString) failed: \(message). If this is a local or Tailscale URL, confirm the inference server is running and the phone can reach that network."
    case .badStatus(let url, let status):
      "\(url.absoluteString) returned HTTP \(status)."
    case .decodeResponseFailed(let url, let message):
      "Couldn't read the response from \(url.absoluteString): \(message)."
    case .unexpected(let message):
      "Inference failed unexpectedly: \(message)."
    }
  }

  var statusDescription: String {
    switch self {
    case .missingBaseURL:
      "Inference URL not configured"
    case .localhostOnDevice:
      "Inference URL points to this iPhone"
    case .encodeRequestFailed:
      "Inference request could not be encoded"
    case .requestFailed:
      "Inference backend unavailable"
    case .badStatus(_, let status):
      "Inference backend returned HTTP \(status)"
    case .decodeResponseFailed:
      "Inference response could not be read"
    case .unexpected:
      "Inference failed unexpectedly"
    }
  }
}

enum WearablesFailure: Error, Equatable, LocalizedError, Sendable {
  case registrationFailed(String)
  case unregistrationFailed(String)
  case cameraPermissionRequiresRegistration
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
      "Couldn't connect your glasses: \(message)"
    case .unregistrationFailed(let message):
      "Couldn't disconnect your glasses: \(message)"
    case .cameraPermissionRequiresRegistration:
      "Connect your glasses before starting a stream."
    case .cameraPermissionFailed(let message):
      "Couldn't get camera permission: \(message)"
    case .callbackFailed(let message):
      "Couldn't finish the Meta AI callback: \(message)"
    }
  }
}

enum StreamFailure: Error, Equatable, LocalizedError, Sendable {
  case noActiveDevice
  case sessionStartFailed(String)
  case sessionStoppedBeforeStart(String?)
  case sessionRuntimeFailed(String)
  case streamRejectedConfiguration
  case streamOpenFailed(String)
  case streamRuntimeFailed(String)
  case recognitionStartFailed(String)
  case recognitionProcessingFailed(String)

  static func sessionStartFailed(_ error: any Error) -> Self {
    .sessionStartFailed(FailureDescriptions.describe(error))
  }

  static func sessionStoppedBeforeStart(_ error: DeviceSessionError?) -> Self {
    .sessionStoppedBeforeStart(error.map(Self.describeSessionError))
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

  static func recognitionProcessingFailed(_ error: any Error) -> Self {
    .recognitionProcessingFailed(FailureDescriptions.describe(error))
  }

  var errorDescription: String? {
    switch self {
    case .noActiveDevice:
      "Put on your glasses to start streaming."
    case .sessionStartFailed(let message):
      "Couldn't start session: \(message)"
    case .sessionStoppedBeforeStart(let message):
      if let message {
        "The glasses session stopped before camera streaming could begin. \(message)"
      } else {
        "The glasses session stopped before camera streaming could begin. Keep the glasses open and near this phone, then try again."
      }
    case .sessionRuntimeFailed(let message):
      "The glasses session stopped: \(message)"
    case .streamRejectedConfiguration:
      "Couldn't open stream because the device rejected the configuration."
    case .streamOpenFailed(let message):
      "Couldn't open stream: \(message)"
    case .streamRuntimeFailed(let message):
      "Stream failed: \(message)"
    case .recognitionStartFailed(let message):
      "Recognition failed: \(message)"
    case .recognitionProcessingFailed(let message):
      "Recognition failed: \(message)"
    }
  }

  private static func describeSessionError(_ error: DeviceSessionError) -> String {
    switch error {
    case .noEligibleDevice:
      "No eligible glasses are available. Open the glasses, keep them near this phone, confirm they are connected in Meta AI, and confirm this app appears in Meta AI App Connections."
    case .sessionAlreadyStopped:
      "The DAT session was already stopped. Wait a moment, then start streaming again."
    case .sessionAlreadyExists:
      "Another DAT session is already active. Stop the current stream or restart Hand Wave and try again."
    case .sessionIdle:
      "The DAT session never left idle. Reopen the glasses and try again."
    case .capabilityAlreadyActive:
      "Camera streaming is already active in this or another DAT session. Stop the existing stream before starting a new one."
    case .capabilityNotFound:
      "The camera capability was removed before streaming could begin. Try starting the stream again."
    case .unexpectedError(let description):
      "The SDK reported an unexpected session error: \(description)"
    case .thermalCritical:
      "The glasses are too warm for streaming. Let them cool down before trying again."
    case .thermalEmergency:
      "The glasses stopped streaming because of a thermal emergency. Let them cool down before trying again."
    case .peakPowerShutdown:
      "The glasses stopped the session because of a peak-power shutdown. Charge them and try again."
    case .batteryCritical:
      "The glasses battery is critically low. Charge them before streaming."
    case .datAppOnTheGlassesUpdateRequired:
      "The Device Access Toolkit app on the glasses needs an update. Open Meta AI and update the DAT wearables app."
    case .dwaUnavailable:
      "The Device Access Toolkit wearables app is unavailable on the glasses. Open Meta AI, reconnect the glasses, and make sure Developer Mode/App Connections are set up."
    @unknown default:
      "The SDK reported \(FailureDescriptions.describe(error))."
    }
  }
}

extension DeviceSessionError {
  var requiresImmediateSessionStop: Bool {
    switch self {
    case .thermalCritical,
      .thermalEmergency,
      .peakPowerShutdown,
      .batteryCritical,
      .datAppOnTheGlassesUpdateRequired:
      true
    default:
      false
    }
  }
}
