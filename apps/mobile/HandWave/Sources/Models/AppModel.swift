import MWDATCore
import Observation

@MainActor
@Observable
final class AppModel {
  let wearables: WearablesModel
  let stream: StreamModel
  var isDevMenuPresented = false
  var showsPoseLandmarks = false

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

  func resetConnection() async {
    await stream.stop()
    await wearables.disconnect()
    refresh()
  }
}
