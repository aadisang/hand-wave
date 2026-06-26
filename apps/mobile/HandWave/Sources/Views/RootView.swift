import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    @Bindable var wearables = appModel.wearables
    @Bindable var stream = appModel.stream
    navigation
      .modifier(
        EventHaptics(
          registered: appModel.wearables.isRegistered,
          streamActive: appModel.stream.isActive,
          wearablesFailure: wearables.failure,
          streamFailure: stream.failure
        )
      )
      .alert(
        "Connection error",
        isPresented: Binding(
          get: { wearables.failure != nil },
          set: { if !$0 { wearables.failure = nil } }
        ),
        presenting: wearables.failure
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0.localizedDescription)
      }
      .alert(
        "Streaming error",
        isPresented: Binding(
          get: { stream.failure != nil },
          set: { if !$0 { stream.failure = nil } }
        ),
        presenting: stream.failure
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0.localizedDescription)
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
  }
}

private struct EventHaptics: ViewModifier {
  let registered: Bool
  let streamActive: Bool
  let wearablesFailure: WearablesFailure?
  let streamFailure: StreamFailure?

  func body(content: Content) -> some View {
    content
      .sensoryFeedback(trigger: registered) { _, isOn in isOn ? Haptic.connected : nil }
      .sensoryFeedback(trigger: streamActive) { _, isOn in isOn ? Haptic.streamLive : nil }
      .sensoryFeedback(trigger: wearablesFailure) { _, failure in
        failure != nil ? Haptic.failure : nil
      }
      .sensoryFeedback(trigger: streamFailure) { _, failure in
        failure != nil ? Haptic.failure : nil
      }
  }
}
