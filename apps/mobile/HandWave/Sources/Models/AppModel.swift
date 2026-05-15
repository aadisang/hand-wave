import MWDATCore
import Observation

@MainActor
@Observable
final class AppModel {
  let wearables: WearablesModel
  let stream: StreamModel

  init(wearables: WearablesInterface = Wearables.shared) {
    let wearablesModel = WearablesModel(wearables: wearables)
    self.wearables = wearablesModel
    self.stream = StreamModel(wearables: wearables)
  }
}
