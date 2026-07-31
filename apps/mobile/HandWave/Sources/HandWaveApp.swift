import MWDATCore
import SwiftUI

@main
struct HandWaveApp: App {
  // Wearables must be configured before AppModel reads Wearables.shared.
  @State private var appModel: AppModel

  init() {
    AppFont.register()
    AppLog.recordLaunch()
    do {
      try Wearables.configure()
      AppLog.wearables.notice("Wearables SDK configured")
    } catch {
      AppLog.app.fault(
        "Wearables configuration failed: \(error.localizedDescription, privacy: .private)")
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
