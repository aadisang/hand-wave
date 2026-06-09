import SwiftUI
import UIKit

struct StreamView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    StreamContent(
      latestFrame: appModel.stream.latestFrame,
      overlayFrame: appModel.stream.overlayFrame,
      statusText: appModel.stream.statusText,
      current: appModel.stream.current,
      stop: appModel.stream.stop
    )
  }
}

private struct StreamContent: View {
  let latestFrame: UIImage?
  let overlayFrame: HandLandmarksFrame
  let statusText: String
  let current: InferSession.Pred?
  let stop: () async -> Void

  var body: some View {
    ZStack(alignment: .bottom) {
      PreviewPane(frame: latestFrame)
      LandmarkOverlay(frame: overlayFrame)
      VStack(spacing: 18) {
        PredictionOverlay(prediction: current)
        StatusBadge(text: statusText)
        StopButton(stop: stop)
      }
      .padding(.horizontal, 24)
      .padding(.bottom, 36)
    }
    .background(.black)
    .ignoresSafeArea()
    .toolbar(.hidden, for: .navigationBar)
    .statusBarHidden()
  }
}

private struct StatusBadge: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(.footnote, design: .monospaced).weight(.semibold))
      .foregroundStyle(.white.opacity(0.78))
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(.black.opacity(0.42), in: Capsule())
  }
}

private struct PreviewPane: View {
  let frame: UIImage?

  @ViewBuilder
  var body: some View {
    if let frame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: 14) {
        ProgressView()
          .tint(.white)
        Text("Starting camera")
          .font(.system(.footnote, design: .monospaced).weight(.semibold))
          .foregroundStyle(.white.opacity(0.72))
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(.black)
    }
  }
}

private struct PredictionOverlay: View {
  let prediction: InferSession.Pred?

  @ViewBuilder
  var body: some View {
    if let prediction {
      VStack(spacing: 6) {
        Text(prediction.text)
          .font(.system(size: 44, weight: .bold, design: .rounded))
          .lineLimit(2)
          .minimumScaleFactor(0.55)
          .multilineTextAlignment(.center)
          .foregroundStyle(.white)
        Text("\(Int((prediction.confidence * 100).rounded()))%")
          .font(.system(.footnote, design: .monospaced).weight(.semibold))
          .foregroundStyle(.white.opacity(0.72))
      }
      .padding(.horizontal, 22)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity)
      .background(.black.opacity(0.48), in: RoundedRectangle(cornerRadius: 8))
      .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
  }
}

private struct StopButton: View {
  let stop: () async -> Void

  var body: some View {
    Button {
      Task { await stop() }
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
