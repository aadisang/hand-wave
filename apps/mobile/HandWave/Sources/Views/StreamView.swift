import SwiftUI
import UIKit

struct StreamView: View {
  @Environment(AppModel.self) private var appModel
  @State private var showLandmarks = true

  var body: some View {
    StreamContent(
      latestFrame: appModel.stream.latestFrame,
      overlayFrame: appModel.stream.overlayFrame,
      current: appModel.stream.current,
      showLandmarks: $showLandmarks,
      stop: appModel.stream.stop
    )
  }
}

private struct StreamContent: View {
  let latestFrame: UIImage?
  let overlayFrame: HandLandmarksFrame
  let current: InferSession.Pred?
  @Binding var showLandmarks: Bool
  let stop: () async -> Void

  var body: some View {
    ZStack {
      // Full-bleed camera stage. Only this layer ignores the safe area, so the
      // floating controls stay clear of the notch and home indicator.
      ZStack {
        Color.stage
        PreviewPane(frame: latestFrame)
        if showLandmarks {
          LandmarkOverlay(frame: overlayFrame)
            .transition(.opacity)
        }
      }
      .ignoresSafeArea()

      VStack(spacing: 0) {
        if let current {
          PredictionOverlay(prediction: current)
        }
        Spacer(minLength: 0)
        ControlBar(showLandmarks: $showLandmarks, stop: stop)
      }
      .padding(.horizontal, Spacing.lg)
      .padding(.vertical, Spacing.sm)
    }
    .background(.stage)
    .toolbar(.hidden, for: .navigationBar)
    .statusBarHidden()
    .animation(Motion.overlay, value: current?.text)
    .animation(Motion.standard, value: showLandmarks)
    .sensoryFeedback(trigger: current?.text) { _, new in
      new != nil ? Haptic.recognized : nil
    }
  }
}

// MARK: - Prediction

private struct PredictionOverlay: View {
  let prediction: InferSession.Pred

  var body: some View {
    // Hierarchy: the recognized sign is the whole point of the screen, so it
    // gets real size and weight — not a caption.
    Text(prediction.text)
      .font(.satoshi(22, .semibold))
      .foregroundStyle(.textPrimary)
      .lineLimit(1)
      .minimumScaleFactor(0.6)
      .padding(.horizontal, Spacing.xl)
      .padding(.vertical, Spacing.md)
    .glassEffect(.regular, in: .capsule)
    // Mirrors the web prediction overlay: blur + subtle scale.
    .transition(.blurReplace.combined(with: .scale(0.98, anchor: .top)))
  }
}

// MARK: - Controls

private struct ControlBar: View {
  @Binding var showLandmarks: Bool
  let stop: () async -> Void
  @State private var stopTaps = 0

  var body: some View {
    GlassEffectContainer(spacing: Spacing.sm) {
      HStack(spacing: Spacing.sm) {
        Button(role: .destructive) {
          stopTaps &+= 1
          Task { await stop() }
        } label: {
          Label("Stop", systemImage: "stop.fill")
            .font(.satoshi(15, .semibold))
        }
        .buttonStyle(.glassProminent)
        .tint(.red)

        Button {
          showLandmarks.toggle()
        } label: {
          Image(systemName: showLandmarks ? "eye.fill" : "eye.slash.fill")
            .font(.body)
        }
        .buttonStyle(.glass)
        .accessibilityLabel(showLandmarks ? "Hide landmarks" : "Show landmarks")
      }
      .controlSize(.large)
      .buttonBorderShape(.capsule)
    }
    .sensoryFeedback(Haptic.stop, trigger: stopTaps)
    .sensoryFeedback(Haptic.toggle, trigger: showLandmarks)
  }
}

// MARK: - Camera

private struct PreviewPane: View {
  let frame: UIImage?

  var body: some View {
    if let frame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: Spacing.md) {
        ProgressView()
          .controlSize(.large)
          .tint(.textSecondary)
        Text("Starting camera")
          .font(.appFootnote)
          .foregroundStyle(.textSecondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}
