import Foundation
import MWDATCore
import Observation

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
    do {
      try await wearables.startRegistration()
      refresh()
    } catch {
      failure = .connection("Connection failed: \(error.localizedDescription)")
    }
  }

  func disconnect() async {
    do {
      try await wearables.startUnregistration()
      refresh()
    } catch {
      failure = .connection("Disconnect failed: \(error.localizedDescription)")
    }
  }

  func ensureCameraPermission() async -> Bool {
    guard isRegistered else {
      failure = .camera("Connect glasses first.")
      return false
    }
    do {
      var status = try await wearables.checkPermissionStatus(.camera)
      if status != .granted {
        status = try await wearables.requestPermission(.camera)
      }
      return status == .granted
    } catch {
      failure = .camera("Camera access failed: \(error.localizedDescription)")
      return false
    }
  }

  func handleCallback(_ url: URL) async {
    do {
      _ = try await wearables.handleUrl(url)
      refresh()
    } catch {
      failure = .callback("Meta AI callback failed: \(error.localizedDescription)")
    }
  }

  func refresh() {
    let state = wearables.registrationState
    let devices = wearables.devices
    if registrationState != state {
      registrationState = state
    }
    if self.devices != devices {
      self.devices = devices
    }
  }

  private func observeRegistration() async {
    for await state in wearables.registrationStateStream() {
      if registrationState != state {
        registrationState = state
      }
    }
  }

  private func observeDevices() async {
    for await devices in wearables.devicesStream() {
      if self.devices != devices {
        self.devices = devices
      }
    }
  }
}
