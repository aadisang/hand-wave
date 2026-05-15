import SwiftUI

struct StreamView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    ZStack(alignment: .bottom) {
      preview
      stopButton
        .padding(.bottom, 36)
    }
    .background(.black)
    .ignoresSafeArea()
    .toolbar(.hidden, for: .navigationBar)
    .statusBarHidden()
  }

  @ViewBuilder
  private var preview: some View {
    if let frame = appModel.stream.latestFrame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      Color.black
    }
  }

  private var stopButton: some View {
    Button {
      Task { await appModel.stream.stop() }
    } label: {
      Image(systemName: "stop.fill")
        .font(.system(size: 28, weight: .bold))
        .foregroundStyle(.white)
        .frame(width: 76, height: 76)
    }
    .buttonStyle(.glassProminent)
    .buttonBorderShape(.circle)
    .tint(.red)
  }
}
