import MWDATCore
import SwiftUI

#if DEBUG
import MWDATMockDevice
#endif

@main
struct HandWaveApp: App {
  // `Wearables.shared` traps with a fatal error if `configure()` hasn't run.
  // Stored properties' default initializers are evaluated before `init()`'s
  // body runs, so we must declare `appModel` without a default and assign it
  // in `init()` *after* calling `Wearables.configure()`. This mirrors the
  // sample app's `_wearablesViewModel = StateObject(wrappedValue: …)` pattern.
  @State private var appModel: AppModel

  init() {
    do {
      try Wearables.configure()
    } catch {
      assertionFailure("Failed to configure Wearables SDK: \(error)")
    }
    _appModel = State(initialValue: AppModel())
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(appModel)
        .onOpenURL { url in
          Task { await appModel.wearables.handleCallback(url) }
        }
    }
  }
}
