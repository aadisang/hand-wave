import MWDATCamera
import MWDATCore

struct StreamDiagnosticState {
  private(set) var sessionState: DeviceSessionState?
  private(set) var streamState: StreamState?
  private(set) var thermalLevel = ThermalLevel.unknown
  private var startedAt: ContinuousClock.Instant?

  var sessionStateName: String { sessionState?.diagnosticName ?? "none" }
  var streamStateName: String { streamState?.diagnosticName ?? "none" }
  var thermalLevelName: String { thermalLevel.diagnosticName }

  mutating func begin(at instant: ContinuousClock.Instant = .now) {
    startedAt = instant
    sessionState = nil
    streamState = nil
  }

  mutating func end() {
    startedAt = nil
  }

  mutating func record(sessionState: DeviceSessionState) {
    self.sessionState = sessionState
  }

  mutating func record(streamState: StreamState) {
    self.streamState = streamState
  }

  mutating func replaceDevice() {
    thermalLevel = .unknown
  }

  mutating func record(thermalLevel: ThermalLevel) -> Bool {
    guard thermalLevel.diagnosticName != self.thermalLevel.diagnosticName else {
      return false
    }
    self.thermalLevel = thermalLevel
    return true
  }

  func elapsedMilliseconds(at instant: ContinuousClock.Instant = .now) -> Int {
    guard let startedAt else { return 0 }
    return milliseconds(from: startedAt, to: instant)
  }
}

func milliseconds(
  from start: ContinuousClock.Instant,
  to end: ContinuousClock.Instant = .now
) -> Int {
  let components = start.duration(to: end).components
  let milliseconds =
    components.seconds * 1_000
    + components.attoseconds / 1_000_000_000_000_000
  return max(0, Int(milliseconds))
}

@MainActor
final class WearableDiagnosticsObserver {
  private let wearables: WearablesInterface
  private var deviceStateTask: Task<Void, Never>?
  private var linkToken: AnyListenerToken?
  private var compatibilityToken: AnyListenerToken?

  init(wearables: WearablesInterface) {
    self.wearables = wearables
  }

  func select(
    _ identifier: DeviceIdentifier?,
    onThermalLevel: @escaping @MainActor (ThermalLevel) -> Bool
  ) async {
    deviceStateTask?.cancel()
    deviceStateTask = nil
    await linkToken?.cancel()
    await compatibilityToken?.cancel()
    linkToken = nil
    compatibilityToken = nil

    guard let identifier else {
      AppLog.wearables.notice("Active glasses unavailable")
      return
    }

    if let device = wearables.deviceForIdentifier(identifier) {
      AppLog.wearables.notice(
        "Active glasses available link=\(device.linkState.diagnosticName, privacy: .public) compatibility=\(device.compatibility().diagnosticName, privacy: .public)"
      )
      linkToken = device.addLinkStateListener { state in
        AppLog.wearables.notice(
          "Glasses link state=\(state.diagnosticName, privacy: .public)"
        )
      }
      compatibilityToken = device.addCompatibilityListener { compatibility in
        AppLog.wearables.notice(
          "Glasses compatibility=\(compatibility.diagnosticName, privacy: .public)"
        )
      }
    } else {
      AppLog.wearables.notice("Active glasses available details=unavailable")
    }

    deviceStateTask = Task { [wearables] in
      for await state in wearables.deviceStateStream(for: identifier) {
        guard !Task.isCancelled else { return }
        guard onThermalLevel(state.thermalLevel) else { continue }
        AppLog.wearables.notice(
          "Glasses thermal state level=\(state.thermalLevel.diagnosticName, privacy: .public)"
        )
      }
    }
  }
}

enum StreamStopReason: Sendable, Equatable {
  case requested
  case appBackgrounded
  case appTerminated
  case connectionReset
  case startCancelled
  case startupFailed
  case streamStateStopped
  case streamError(StreamError)
  case sessionError(DeviceSessionError)

  var diagnosticName: String {
    switch self {
    case .requested: "requested"
    case .appBackgrounded: "app_backgrounded"
    case .appTerminated: "app_terminated"
    case .connectionReset: "connection_reset"
    case .startCancelled: "start_cancelled"
    case .startupFailed: "startup_failed"
    case .streamStateStopped: "stream_state_stopped"
    case .streamError(let error): "stream_error.\(error.diagnosticName)"
    case .sessionError(let error): "session_error.\(error.diagnosticName)"
    }
  }
}

extension StreamError {
  var diagnosticName: String {
    switch self {
    case .internalError: "internal_error"
    case .deviceNotFound: "device_not_found"
    case .deviceNotConnected: "device_not_connected"
    case .timeout: "timeout"
    case .videoStreamingError: "video_streaming_error"
    case .permissionDenied: "permission_denied"
    case .hingesClosed: "hinges_closed"
    case .thermalCritical: "thermal_critical"
    case .thermalEmergency: "thermal_emergency"
    case .peakPowerShutdown: "peak_power_shutdown"
    case .batteryCritical: "battery_critical"
    @unknown default: "unknown"
    }
  }
}

extension DeviceSessionError {
  var diagnosticName: String {
    switch self {
    case .noEligibleDevice: "no_eligible_device"
    case .sessionAlreadyStopped: "session_already_stopped"
    case .sessionAlreadyExists: "session_already_exists"
    case .sessionIdle: "session_idle"
    case .capabilityAlreadyActive: "capability_already_active"
    case .capabilityNotFound: "capability_not_found"
    case .unexpectedError: "unexpected_error"
    case .thermalCritical: "thermal_critical"
    case .thermalEmergency: "thermal_emergency"
    case .peakPowerShutdown: "peak_power_shutdown"
    case .batteryCritical: "battery_critical"
    case .datAppOnTheGlassesUpdateRequired: "dat_app_update_required"
    case .dwaUnavailable: "dwa_unavailable"
    }
  }
}

extension DeviceSessionState {
  var diagnosticName: String {
    switch self {
    case .idle: "idle"
    case .starting: "starting"
    case .started: "started"
    case .paused: "paused"
    case .stopping: "stopping"
    case .stopped: "stopped"
    }
  }
}

extension StreamState {
  var diagnosticName: String {
    switch self {
    case .stopping: "stopping"
    case .stopped: "stopped"
    case .waitingForDevice: "waiting_for_device"
    case .starting: "starting"
    case .streaming: "streaming"
    case .paused: "paused"
    }
  }
}

extension ThermalLevel {
  var diagnosticName: String {
    switch self {
    case .unknown: "unknown"
    case .none: "none"
    case .light: "light"
    case .moderate: "moderate"
    case .severe: "severe"
    case .critical: "critical"
    case .emergency: "emergency"
    case .shutdown: "shutdown"
    }
  }
}

extension LinkState {
  var diagnosticName: String {
    switch self {
    case .disconnected: "disconnected"
    case .connecting: "connecting"
    case .connected: "connected"
    }
  }
}

extension Compatibility {
  var diagnosticName: String {
    switch self {
    case .undefined: "undefined"
    case .compatible: "compatible"
    case .deviceUpdateRequired: "device_update_required"
    case .sdkUpdateRequired: "sdk_update_required"
    @unknown default: "unknown"
    }
  }
}

extension RegistrationState {
  var diagnosticName: String {
    switch self {
    case .unavailable: "unavailable"
    case .available: "available"
    case .registering: "registering"
    case .registered: "registered"
    @unknown default: "unknown"
    }
  }
}

extension PermissionStatus {
  var diagnosticName: String {
    switch self {
    case .granted: "granted"
    case .denied: "denied"
    @unknown default: "unknown"
    }
  }
}
