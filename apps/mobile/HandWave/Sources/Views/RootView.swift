import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    @Bindable var wearables = appModel.wearables
    @Bindable var stream = appModel.stream
    NavigationStack {
      Group {
        if appModel.stream.isActive {
          StreamView()
        } else {
          PairingView()
        }
      }
      .toolbar(.hidden, for: .navigationBar)
    }
    .task { await appModel.wearables.observe() }
    .task { await appModel.stream.observe() }
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
}
