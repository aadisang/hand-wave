import AVFoundation
import SwiftUI
import UIKit

struct StreamView: View {
  @Environment(AppModel.self) private var appModel
  @AppStorage(AppSettingKey.showsLandmarks) private var showsLandmarks = true
  @AppStorage(AppSettingKey.showsPoseLandmarks) private var showsPoseLandmarks = false

  var body: some View {
    StreamContent(
      source: appModel.stream.activeSource ?? appModel.stream.source,
      phoneSession: appModel.stream.phoneSession,
      latestFrame: appModel.stream.latestFrame,
      overlayFrame: appModel.stream.overlayFrame,
      current: appModel.stream.current,
      isSpeaking: appModel.stream.isSpeaking,
      backendMessage: appModel.stream.backendMessage,
      startupMessage: appModel.stream.startupMessage,
      showsPoseLandmarks: showsPoseLandmarks,
      showsLandmarks: showsLandmarks,
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
  let current: Prediction?
  let isSpeaking: Bool
  let backendMessage: String?
  let startupMessage: String?
  let showsPoseLandmarks: Bool
  let showsLandmarks: Bool
  let rotateCamera: () async -> Void
  let stop: () async -> Void

  var body: some View {
    ZStack {
      ZStack {
        Color.stage
        PreviewPane(source: source, phoneSession: phoneSession, frame: latestFrame)
        if showsLandmarks {
          LandmarkOverlay(frame: overlayFrame, showsPose: showsPoseLandmarks)
            .transition(.opacity)
        }
        if let startupMessage {
          StartupOverlay(message: startupMessage)
            .transition(.opacity)
        }
      }
      .ignoresSafeArea()

      VStack(spacing: 0) {
        if let current {
          PredictionOverlay(prediction: current, isSpeaking: isSpeaking)
        } else if let backendMessage {
          Text(backendMessage)
            .font(.appFootnote)
            .foregroundStyle(.textSecondary)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .glassEffect(.regular, in: .capsule)
        }
        Spacer(minLength: 0)
        ControlBar(
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
    .animation(Motion.standard, value: startupMessage)
  }
}

private struct PredictionOverlay: View {
  let prediction: Prediction
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
  let canRotateCamera: Bool
  let rotateCamera: () async -> Void
  let stop: () async -> Void

  var body: some View {
    GlassEffectContainer(spacing: Spacing.sm) {
      HStack(spacing: Spacing.sm) {
        Button(role: .destructive) {
          Task { await stop() }
        } label: {
          Label("Stop", systemImage: "stop.fill")
            .font(.satoshi(15, .semibold))
        }
        .buttonStyle(.glassProminent)
        .tint(.red)

        if canRotateCamera {
          Button {
            Task { await rotateCamera() }
          } label: {
            Image(systemName: "arrow.triangle.2.circlepath.camera")
              .font(.body)
          }
          .buttonStyle(.glass)
          .accessibilityLabel("Switch camera")
        }
      }
      .controlSize(.large)
      .buttonBorderShape(.capsule)
    }
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
      Color.stage
    }
  }
}

private struct StartupOverlay: View {
  let message: String

  var body: some View {
    VStack(spacing: Spacing.md) {
      ProgressView()
        .controlSize(.large)
        .tint(.textPrimary)
      Text(message)
        .font(.appFootnote)
        .foregroundStyle(.textSecondary)
    }
    .padding(.horizontal, Spacing.xl)
    .padding(.vertical, Spacing.lg)
    .glassEffect(.regular, in: .rect(cornerRadius: 20))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(message)
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
