import MWDATCore
import SwiftUI

@main
struct HandWaveApp: App {
  // Wearables must be configured before AppModel reads Wearables.shared.
  @State private var appModel: AppModel

  init() {
    AppFont.register()
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
