import Foundation
import MWDATCore
import Observation

enum WearablesFailure: Error, LocalizedError, Sendable {
  case connection(String)
  case camera(String)
  case callback(String)

  var errorDescription: String? {
    switch self {
    case .connection(let message), .camera(let message), .callback(let message): message
    }
  }
}

@MainActor
@Observable
final class WearablesModel {
  private(set) var registrationState: RegistrationState
  private(set) var devices: [DeviceIdentifier]
  var failure: WearablesFailure?

  private let wearables: WearablesInterface

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.registrationState = wearables.registrationState
    self.devices = wearables.devices
    AppLog.wearables.notice(
      "Wearables model initialized registration=\(self.registrationState.diagnosticName, privacy: .public) device_count=\(self.devices.count)"
    )
  }

  var isRegistered: Bool { registrationState == .registered }
  var isRegistering: Bool { registrationState == .registering }

  func deviceName(for identifier: DeviceIdentifier) -> String {
    wearables.deviceForIdentifier(identifier)?.nameOrId() ?? "Wearable"
  }

  func observe() async {
    refresh()
    await withTaskGroup(of: Void.self) { group in
      group.addTask { [self] in await observeRegistration() }
      group.addTask { [self] in await observeDevices() }
    }
  }

  func connect() async {
    AppLog.wearables.notice("Registration requested")
    do {
      try await wearables.startRegistration()
      refresh()
      AppLog.wearables.notice(
        "Registration request completed state=\(self.registrationState.diagnosticName, privacy: .public)"
      )
    } catch {
      failure = .connection(error.localizedDescription)
      AppLog.wearables.error(
        "Registration failed error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
    }
  }

  func disconnect() async {
    AppLog.wearables.notice("Unregistration requested")
    do {
      try await wearables.startUnregistration()
      refresh()
      AppLog.wearables.notice(
        "Unregistration request completed state=\(self.registrationState.diagnosticName, privacy: .public)"
      )
    } catch {
      failure = .connection(error.localizedDescription)
      AppLog.wearables.error(
        "Unregistration failed error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
    }
  }

  func ensureCameraPermission() async -> Bool {
    guard isRegistered else {
      failure = .camera("Connect glasses first.")
      return false
    }
    do {
      var status = try await wearables.checkPermissionStatus(.camera)
      AppLog.wearables.notice(
        "Camera permission checked status=\(status.diagnosticName, privacy: .public)"
      )
      if status != .granted {
        AppLog.wearables.notice("Camera permission requested")
        status = try await wearables.requestPermission(.camera)
        AppLog.wearables.notice(
          "Camera permission request completed status=\(status.diagnosticName, privacy: .public)"
        )
      }
      return status == .granted
    } catch {
      failure = .camera(error.localizedDescription)
      AppLog.wearables.error(
        "Camera permission failed error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
      return false
    }
  }

  func handleCallback(_ url: URL) async {
    AppLog.wearables.notice(
      "Wearables callback received scheme=\(url.scheme ?? "none", privacy: .public)"
    )
    do {
      let handled = try await wearables.handleUrl(url)
      refresh()
      AppLog.wearables.notice(
        "Wearables callback completed handled=\(handled) registration=\(self.registrationState.diagnosticName, privacy: .public)"
      )
    } catch {
      failure = .callback(error.localizedDescription)
      AppLog.wearables.error(
        "Wearables callback failed error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
    }
  }

  func refresh() {
    updateRegistrationState(wearables.registrationState)
    updateDevices(wearables.devices)
  }

  private func observeRegistration() async {
    for await state in wearables.registrationStateStream() {
      updateRegistrationState(state)
    }
  }

  private func observeDevices() async {
    for await devices in wearables.devicesStream() {
      updateDevices(devices)
    }
  }

  private func updateRegistrationState(_ state: RegistrationState) {
    guard registrationState != state else { return }
    AppLog.wearables.notice(
      "Registration state changed from=\(self.registrationState.diagnosticName, privacy: .public) to=\(state.diagnosticName, privacy: .public)"
    )
    registrationState = state
  }

  private func updateDevices(_ devices: [DeviceIdentifier]) {
    guard self.devices != devices else { return }
    AppLog.wearables.notice(
      "Wearables device list changed previous_count=\(self.devices.count) current_count=\(devices.count)"
    )
    self.devices = devices
  }
}
