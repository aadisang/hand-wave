import AVFoundation
import SwiftUI
import UIKit

struct StreamView: View {
  @Environment(AppModel.self) private var appModel
  @State private var showLandmarks = true

  var body: some View {
    StreamContent(
      source: appModel.stream.activeSource ?? appModel.stream.source,
      phoneSession: appModel.stream.phoneSession,
      latestFrame: appModel.stream.latestFrame,
      overlayFrame: appModel.stream.overlayFrame,
      current: appModel.stream.current,
      isSpeaking: appModel.stream.isSpeaking,
      showsPoseLandmarks: appModel.showsPoseLandmarks,
      showLandmarks: $showLandmarks,
      rotateCamera: appModel.stream.rotateCamera,
      stop: appModel.stream.stop
    )
  }
}

private struct StreamContent: View {
  let source: StreamModel.Source
  let phoneSession: AVCaptureSession
  let latestFrame: UIImage?
  let overlayFrame: HandLandmarksFrame
  let current: InferSession.Pred?
  let isSpeaking: Bool
  let showsPoseLandmarks: Bool
  @Binding var showLandmarks: Bool
  let rotateCamera: () async -> Void
  let stop: () async -> Void

  var body: some View {
    ZStack {
      ZStack {
        Color.stage
        PreviewPane(source: source, phoneSession: phoneSession, frame: latestFrame)
        if showLandmarks {
          LandmarkOverlay(frame: overlayFrame, showsPose: showsPoseLandmarks)
            .transition(.opacity)
        }
      }
      .ignoresSafeArea()

      VStack(spacing: 0) {
        if let current {
          PredictionOverlay(prediction: current, isSpeaking: isSpeaking)
        }
        Spacer(minLength: 0)
        ControlBar(
          showLandmarks: $showLandmarks,
          canRotateCamera: source == .phone,
          rotateCamera: rotateCamera,
          stop: stop
        )
      }
      .padding(.horizontal, Spacing.lg)
      .padding(.vertical, Spacing.sm)
    }
    .background(.stage)
    .toolbar(.hidden, for: .navigationBar)
    .statusBarHidden()
    .animation(Motion.overlay, value: current?.text)
    .animation(Motion.overlay, value: isSpeaking)
    .animation(Motion.standard, value: showLandmarks)
    .sensoryFeedback(trigger: isSpeaking) { _, speaking in
      speaking ? Haptic.recognized : nil
    }
  }
}

private struct PredictionOverlay: View {
  let prediction: InferSession.Pred
  let isSpeaking: Bool

  var body: some View {
    HStack(spacing: Spacing.sm) {
      if isSpeaking {
        Image(systemName: "speaker.wave.2.fill")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.textPrimary)
          .imageScale(.medium)
          .transition(.scale(scale: 0.86).combined(with: .opacity))
      }

      Text(prediction.text)
        .font(.satoshi(22, .semibold))
        .foregroundStyle(.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .padding(.horizontal, Spacing.xl)
    .padding(.vertical, Spacing.md)
    .glassEffect(.regular, in: .capsule)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(isSpeaking ? "\(prediction.text), speaking" : prediction.text)
    .transition(.blurReplace.combined(with: .scale(0.98, anchor: .top)))
  }
}

private struct ControlBar: View {
  @Binding var showLandmarks: Bool
  let canRotateCamera: Bool
  let rotateCamera: () async -> Void
  let stop: () async -> Void
  @State private var rotateTaps = 0
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

        if canRotateCamera {
          Button {
            rotateTaps &+= 1
            Task { await rotateCamera() }
          } label: {
            Image(systemName: "arrow.triangle.2.circlepath.camera")
              .font(.body)
          }
          .buttonStyle(.glass)
          .accessibilityLabel("Switch camera")
        }

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
    .sensoryFeedback(Haptic.toggle, trigger: rotateTaps)
    .sensoryFeedback(Haptic.toggle, trigger: showLandmarks)
  }
}

private struct PreviewPane: View {
  let source: StreamModel.Source
  let phoneSession: AVCaptureSession
  let frame: UIImage?

  var body: some View {
    if source == .phone {
      PhoneCameraPreview(session: phoneSession)
        .ignoresSafeArea()
    } else if let frame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: Spacing.md) {
        ProgressView()
          .controlSize(.large)
          .tint(.textSecondary)
        Text("Starting")
          .font(.appFootnote)
          .foregroundStyle(.textSecondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

private struct PhoneCameraPreview: UIViewRepresentable {
  let session: AVCaptureSession

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView()
    view.previewLayer.videoGravity = .resizeAspectFill
    view.previewLayer.session = session
    return view
  }

  func updateUIView(_ view: PreviewView, context: Context) {
    view.previewLayer.session = session
  }

  final class PreviewView: UIView {
    override class var layerClass: AnyClass {
      AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer {
      layer as! AVCaptureVideoPreviewLayer
    }
  }
}
