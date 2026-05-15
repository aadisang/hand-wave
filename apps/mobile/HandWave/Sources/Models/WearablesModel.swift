import Foundation
import MWDATCore
import Observation

@MainActor
@Observable
final class WearablesModel {
  private(set) var registrationState: RegistrationState
  private(set) var devices: [DeviceIdentifier]
  var errorMessage: String?

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

  /// Drives the registration + devices streams for the lifetime of the caller.
  /// Cancelled automatically when the SwiftUI `.task` that owns it disappears.
  func observe() async {
    await withTaskGroup(of: Void.self) { group in
      group.addTask { [self] in await observeRegistration() }
      group.addTask { [self] in await observeDevices() }
    }
  }

  func connect() async {
    do {
      try await wearables.startRegistration()
    } catch {
      errorMessage = error.description
    }
  }

  func disconnect() async {
    do {
      try await wearables.startUnregistration()
    } catch {
      errorMessage = error.description
    }
  }

  func ensureCameraPermission() async -> Bool {
    guard isRegistered else {
      errorMessage = "Connect your glasses before starting a stream."
      return false
    }
    do {
      var status = try await wearables.checkPermissionStatus(.camera)
      if status != .granted {
        status = try await wearables.requestPermission(.camera)
      }
      return status == .granted
    } catch {
      errorMessage = error.description
      return false
    }
  }

  func handleCallback(_ url: URL) async {
    do {
      _ = try await wearables.handleUrl(url)
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func observeRegistration() async {
    for await state in wearables.registrationStateStream() {
      registrationState = state
    }
  }

  private func observeDevices() async {
    for await devices in wearables.devicesStream() {
      self.devices = devices
    }
  }
}
