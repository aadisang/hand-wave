import SwiftUI
import UIKit

struct RootView: View {
  @Environment(\.scenePhase) private var scenePhase
  @Environment(AppModel.self) private var appModel

  var body: some View {
    @Bindable var app = appModel
    navigation
      .alert(
        "Something went wrong",
        isPresented: Binding(
          get: { appModel.wearables.failure != nil },
          set: { if !$0 { appModel.wearables.failure = nil } }
        ),
        presenting: appModel.wearables.failure
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0.localizedDescription)
      }
      .alert(
        "Something went wrong",
        isPresented: Binding(
          get: { appModel.stream.failure != nil },
          set: { if !$0 { appModel.stream.failure = nil } }
        ),
        presenting: appModel.stream.failure
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0.localizedDescription)
      }
      .sheet(isPresented: $app.isDevMenuPresented) {
        DevMenuView()
      }
      .background {
        ShakeDetector {
          appModel.isDevMenuPresented = true
        }
        .frame(width: 0, height: 0)
      }
  }

  private var navigation: some View {
    NavigationStack {
      Group {
        if appModel.stream.isActive {
          StreamView()
            .transition(.opacity)
        } else {
          PairingView()
            .transition(.opacity)
        }
      }
      .toolbar(.hidden, for: .navigationBar)
      .animation(Motion.standard, value: appModel.stream.isActive)
    }
    .font(.appBody)
    .tint(.primarySolid)
    .preferredColorScheme(.dark)
    .task { await appModel.wearables.observe() }
    .task { await appModel.stream.observe() }
    .task(priority: .utility) {
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      await appModel.stream.prepare()
    }
    .task { await stopOnQuit() }
    .onChange(of: scenePhase) { _, phase in
      switch phase {
      case .active:
        appModel.refresh()
      case .background:
        Task { await appModel.stream.stop() }
      default:
        break
      }
    }
  }

  private func stopOnQuit() async {
    for await _ in NotificationCenter.default.notifications(
      named: UIApplication.willTerminateNotification
    ) {
      await appModel.stream.stop()
    }
  }
}
