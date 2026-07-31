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
      speakingText: appModel.stream.speakingText,
      framingMessage: appModel.stream.framingMessage,
      backendMessage: appModel.stream.backendMessage,
      isLoading: appModel.stream.isPreparingLandmarks,
      showsPoseLandmarks: showsPoseLandmarks,
      showsLandmarks: showsLandmarks,
      rotateCamera: appModel.stream.rotateCamera,
      stop: { await appModel.stream.stop() }
    )
  }
}

private struct StreamContent: View {
  private enum OverlayPresentation: Equatable {
    case absent
    case prediction
    case speaking
    case framing
    case backend
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let source: StreamModel.Source
  let phoneSession: AVCaptureSession
  let latestFrame: UIImage?
  let overlayFrame: LandmarkOverlayFrame
  let current: Prediction?
  let speakingText: String?
  let framingMessage: String?
  let backendMessage: String?
  let isLoading: Bool
  let showsPoseLandmarks: Bool
  let showsLandmarks: Bool
  let rotateCamera: () async -> Void
  let stop: () async -> Void

  private var overlayPresentation: OverlayPresentation {
    if speakingText != nil { return .speaking }
    if current != nil { return .prediction }
    if framingMessage != nil { return .framing }
    if backendMessage != nil { return .backend }
    return .absent
  }

  var body: some View {
    ZStack {
      ZStack {
        Color.stage
        PreviewPane(source: source, phoneSession: phoneSession, frame: latestFrame)
        if showsLandmarks {
          LandmarkOverlay(
            frame: overlayFrame.landmarks,
            imageSize: overlayFrame.imageSize,
            showsPose: showsPoseLandmarks,
            previewMode: source == .phone ? .fill : .fit
          )
          .transition(.opacity)
        }
        if isLoading {
          ProgressView()
            .progressViewStyle(.circular)
            .controlSize(.large)
            .tint(.textPrimary)
            .transition(.opacity)
        }
      }
      .ignoresSafeArea()

      VStack(spacing: 0) {
        if let speakingText {
          PredictionOverlay(
            text: speakingText,
            isSpeaking: true,
            reduceMotion: reduceMotion
          )
        } else if let current {
          PredictionOverlay(
            text: current.text,
            isSpeaking: false,
            reduceMotion: reduceMotion
          )
        } else if let framingMessage {
          FramingHint(message: framingMessage)
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
    .animation(Motion.overlay, value: overlayPresentation)
    .animation(Motion.standard, value: isLoading)
  }
}

private struct FramingHint: View {
  let message: String

  var body: some View {
    Label(message, systemImage: "figure.stand")
      .font(.appFootnote)
      .foregroundStyle(.textPrimary)
      .multilineTextAlignment(.center)
      .padding(.horizontal, Spacing.lg)
      .padding(.vertical, Spacing.md)
      .glassEffect(.regular, in: .capsule)
      .accessibilityLabel(message)
  }
}

private struct PredictionOverlay: View {
  let text: String
  let isSpeaking: Bool
  let reduceMotion: Bool

  var body: some View {
    if reduceMotion {
      overlay.transition(.opacity)
    } else {
      overlay.transition(.blurReplace.combined(with: .scale(0.98, anchor: .top)))
    }
  }

  private var overlay: some View {
    HStack(spacing: Spacing.sm) {
      if isSpeaking {
        if reduceMotion {
          speakingGlyph.transition(.opacity)
        } else {
          speakingGlyph.transition(.scale(scale: 0.94).combined(with: .opacity))
        }
      }

      Text(text)
        .font(.satoshi(22, .semibold))
        .foregroundStyle(.textPrimary)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .padding(.horizontal, Spacing.xl)
    .padding(.vertical, Spacing.md)
    .glassEffect(.regular, in: .capsule)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(isSpeaking ? "\(text), speaking" : text)
  }

  private var speakingGlyph: some View {
    Image(systemName: "speaker.wave.2.fill")
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(.textPrimary)
      .imageScale(.medium)
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
