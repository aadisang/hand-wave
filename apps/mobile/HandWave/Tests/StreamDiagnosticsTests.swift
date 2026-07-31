import MWDATCamera
import MWDATCore
import Testing

@testable import HandWave

struct StreamDiagnosticsTests {
  @Test
  func streamStateTracksTypedValuesAndResetsPerDevice() {
    let startedAt = ContinuousClock.now
    var state = StreamDiagnosticState()

    state.begin(at: startedAt)
    state.record(sessionState: .started)
    state.record(streamState: .streaming)
    let didRecordSevere = state.record(thermalLevel: .severe)
    #expect(didRecordSevere)

    #expect(state.sessionStateName == "started")
    #expect(state.streamStateName == "streaming")
    #expect(state.thermalLevelName == "severe")
    #expect(
      state.elapsedMilliseconds(
        at: startedAt.advanced(by: .seconds(2))
      ) == 2_000
    )

    state.replaceDevice()
    #expect(state.thermalLevelName == "unknown")
    let didRecordUnknown = state.record(thermalLevel: .unknown)
    #expect(!didRecordUnknown)

    state.end()
    #expect(state.elapsedMilliseconds(at: startedAt) == 0)
  }

  @Test
  func cameraErrorsHaveStableNames() {
    let errors: [(StreamError, String)] = [
      (.internalError, "internal_error"),
      (.deviceNotFound("device"), "device_not_found"),
      (.deviceNotConnected("device"), "device_not_connected"),
      (.timeout, "timeout"),
      (.videoStreamingError, "video_streaming_error"),
      (.permissionDenied, "permission_denied"),
      (.hingesClosed, "hinges_closed"),
      (.thermalCritical, "thermal_critical"),
      (.thermalEmergency, "thermal_emergency"),
      (.peakPowerShutdown, "peak_power_shutdown"),
      (.batteryCritical, "battery_critical"),
    ]

    for (error, name) in errors {
      #expect(error.diagnosticName == name)
    }
  }

  @Test
  func sessionErrorsHaveStableNames() {
    let errors: [(DeviceSessionError, String)] = [
      (.noEligibleDevice, "no_eligible_device"),
      (.sessionAlreadyStopped, "session_already_stopped"),
      (.sessionAlreadyExists, "session_already_exists"),
      (.sessionIdle, "session_idle"),
      (.capabilityAlreadyActive, "capability_already_active"),
      (.capabilityNotFound, "capability_not_found"),
      (.unexpectedError(description: "detail"), "unexpected_error"),
      (.thermalCritical, "thermal_critical"),
      (.thermalEmergency, "thermal_emergency"),
      (.peakPowerShutdown, "peak_power_shutdown"),
      (.batteryCritical, "battery_critical"),
      (.datAppOnTheGlassesUpdateRequired, "dat_app_update_required"),
      (.dwaUnavailable, "dwa_unavailable"),
    ]

    for (error, name) in errors {
      #expect(error.diagnosticName == name)
    }
  }

  @Test
  func stopReasonIncludesTypedSdkError() {
    #expect(
      StreamStopReason.streamError(.videoStreamingError).diagnosticName
        == "stream_error.video_streaming_error"
    )
    #expect(
      StreamStopReason.sessionError(.thermalEmergency).diagnosticName
        == "session_error.thermal_emergency"
    )
  }

  @Test
  func thermalLevelsHaveStableNames() {
    let levels: [(ThermalLevel, String)] = [
      (.unknown, "unknown"),
      (.none, "none"),
      (.light, "light"),
      (.moderate, "moderate"),
      (.severe, "severe"),
      (.critical, "critical"),
      (.emergency, "emergency"),
      (.shutdown, "shutdown"),
    ]

    for (level, name) in levels {
      #expect(level.diagnosticName == name)
    }
  }
}
