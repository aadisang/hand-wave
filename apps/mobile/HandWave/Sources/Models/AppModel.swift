import MWDATCore
import Observation

@MainActor
@Observable
final class AppModel {
  let wearables: WearablesModel
  let stream: StreamModel
  var isDevMenuPresented = false

  init(wearables: WearablesInterface = Wearables.shared) {
    let wearablesModel = WearablesModel(wearables: wearables)
    self.wearables = wearablesModel
    self.stream = StreamModel(wearables: wearables)
  }

  var canResetConnection: Bool {
    stream.isActive || wearables.isRegistered || wearables.isRegistering
  }

  func refresh() {
    wearables.refresh()
    stream.refresh()
  }

  func performPrimaryAction() async {
    refresh()
    if stream.source == .phone {
      await stream.start()
    } else if !wearables.isRegistered {
      await wearables.connect()
    } else if stream.hasActiveDevice, await wearables.ensureCameraPermission() {
      await stream.start()
    }
  }

  func resetConnection() async {
    await stream.stop()
    await wearables.disconnect()
    refresh()
  }
}
