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
          wearablesError: wearables.errorMessage,
          streamError: stream.errorMessage
        )
      )
      .alert(
        "Connection error",
        isPresented: Binding(
          get: { wearables.errorMessage != nil },
          set: { if !$0 { wearables.errorMessage = nil } }
        ),
        presenting: wearables.errorMessage
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0)
      }
      .alert(
        "Streaming error",
        isPresented: Binding(
          get: { stream.errorMessage != nil },
          set: { if !$0 { stream.errorMessage = nil } }
        ),
        presenting: stream.errorMessage
      ) { _ in
        Button("OK", role: .cancel) {}
      } message: {
        Text($0)
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
  let wearablesError: String?
  let streamError: String?

  func body(content: Content) -> some View {
    content
      .sensoryFeedback(trigger: registered) { _, isOn in isOn ? Haptic.connected : nil }
      .sensoryFeedback(trigger: streamActive) { _, isOn in isOn ? Haptic.streamLive : nil }
      .sensoryFeedback(trigger: wearablesError) { _, message in
        message != nil ? Haptic.failure : nil
      }
      .sensoryFeedback(trigger: streamError) { _, message in message != nil ? Haptic.failure : nil }
  }
}
