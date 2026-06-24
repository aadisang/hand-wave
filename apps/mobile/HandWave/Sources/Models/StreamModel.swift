import Dependencies
import MWDATCamera
import MWDATCore
import Observation
import UIKit

@MainActor
@Observable
final class StreamModel {
  enum Status { case idle, connecting, streaming }

  private(set) var status: Status = .idle
  private(set) var hasActiveDevice: Bool = false
  private(set) var latestFrame: UIImage?
  private(set) var overlayFrame = HandLandmarksFrame.empty
  private(set) var statusText = "Starting recognition"
  private(set) var current: InferSession.Pred?
  private(set) var transcript: [InferSession.Pred] = []
  var errorMessage: String?

  @ObservationIgnored
  @Dependency(\.recognizer) private var recognizer

  private let wearables: WearablesInterface
  private let selector: AutoDeviceSelector
  private let speech = Speech()
  private let frameGate = FrameGate(previewFPS: 24, recognitionFPS: 10)
  private var session: DeviceSession?
  private var stream: MWDATCamera.Stream?
  private var stateToken: AnyListenerToken?
  private var frameToken: AnyListenerToken?
  private var errorToken: AnyListenerToken?
  private var missingRecognitionOutputs = 0
  private static let missingStatusThreshold = 4

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.selector = AutoDeviceSelector(wearables: wearables)
  }

  var isStreaming: Bool { status == .streaming }
  var isActive: Bool { status != .idle }

  /// Watches the active-device stream for the lifetime of the caller. Owned
  /// by SwiftUI's `.task` modifier on `RootView` — cancels on view disappear.
  func observe() async {
    for await device in selector.activeDeviceStream() {
      hasActiveDevice = device != nil
    }
  }

  func start() async {
    guard status == .idle else { return }
    guard hasActiveDevice else {
      errorMessage = "Put on your glasses to start streaming."
      return
    }
    status = .connecting
    do {
      let session = try wearables.createSession(deviceSelector: selector)
      self.session = session

      // Subscribe to the state stream *before* starting the session so we
      // don't miss the synchronous `.started` event the SDK emits.
      let stateStream = session.stateStream()
      try session.start()

      for await sessionState in stateStream {
        if sessionState == .started {
          await openStream(on: session)
          return
        } else if sessionState == .stopped {
          await teardown()
          return
        }
      }
    } catch {
      errorMessage = "Couldn't start session: \(error.localizedDescription)"
      await teardown()
    }
  }

  func stop() async {
    await teardown()
  }

  private func openStream(on session: DeviceSession) async {
    speech.prepareForStreaming()

    let config = StreamConfiguration(
      videoCodec: .raw,
      resolution: .low,
      frameRate: 24
    )
    let stream: MWDATCamera.Stream
    do {
      guard let opened = try session.addStream(config: config) else {
        errorMessage = "Couldn't open stream — the device rejected the configuration."
        await teardown()
        return
      }
      stream = opened
    } catch {
      errorMessage = "Couldn't open stream: \(error.localizedDescription)"
      await teardown()
      return
    }
    self.stream = stream

    do {
      try await recognizer.start()
    } catch {
      errorMessage = "Recognition failed: \(error.localizedDescription)"
      await teardown()
      return
    }

    stateToken = stream.statePublisher.listen { [weak self] state in
      Task { @MainActor [weak self] in
        guard let self else { return }
        switch state {
        case .streaming:
          self.status = .streaming
        case .stopped:
          Task { await self.teardown() }
        case .waitingForDevice, .starting, .paused, .stopping:
          self.status = .connecting
        }
      }
    }

    errorToken = stream.errorPublisher.listen { [weak self] error in
      Task { @MainActor [weak self] in
        self?.errorMessage = "Stream failed: \(String(describing: error))"
        await self?.teardown()
      }
    }

    let frameGate = frameGate
    frameToken = stream.videoFramePublisher.listen { [weak self, recognizer, frameGate] frame in
      Task { [weak self, recognizer, frameGate] in
        let decision = await frameGate.accept()
        guard decision.hasWork else { return }

        if decision.preview {
          Task(priority: .userInitiated) { [weak self, frameGate] in
            let image = frame.makeUIImage()
            await MainActor.run {
              guard let self, self.status != .idle, let image else { return }
              self.latestFrame = image
            }
            await frameGate.finishPreview()
          }
        }

        if decision.recognition {
          Task(priority: .utility) { [weak self, recognizer, frameGate] in
            do {
              let output = try await recognizer.process(frame)
              await MainActor.run {
                guard self?.status != .idle else { return }
                self?.apply(output)
              }
            } catch {
              await MainActor.run {
                guard self?.status != .idle else { return }
                self?.statusText = "Recognition failed: \(error.localizedDescription)"
              }
            }
            await frameGate.finishRecognition()
          }
        }
      }
    }

    await stream.start()
  }

  private func statusText(for output: Recognizer.Output) -> String {
    if let error = output.error { return "Backend: \(error)" }
    if output.hasFrame {
      missingRecognitionOutputs = 0
      return "Reading sign"
    }

    missingRecognitionOutputs += 1
    if missingRecognitionOutputs < Self.missingStatusThreshold,
      current != nil || statusText == "Reading sign"
    {
      return statusText
    }

    return output.overlayFrame.isEmpty
      ? "Looking for hand and body"
      : "Need hand and body in frame"
  }

  private func apply(_ output: Recognizer.Output) {
    if overlayFrame != output.overlayFrame {
      overlayFrame = output.overlayFrame
    }

    let statusText = statusText(for: output)
    if self.statusText != statusText {
      self.statusText = statusText
    }

    apply(output.event)
  }

  private func apply(_ event: InferSession.Event?) {
    guard let event else { return }
    switch event {
    case .clear:
      if current != nil {
        current = nil
      }
    case .partial(let prediction):
      if current != prediction {
        current = prediction
      }
    case .finalized(let prediction):
      if current != prediction {
        current = prediction
      }
      transcript.append(prediction)
      speech.speak(prediction.text)
    }
  }

  private func teardown() async {
    let stream = self.stream
    let session = self.session
    self.stream = nil
    self.session = nil
    stateToken = nil
    frameToken = nil
    errorToken = nil
    await frameGate.reset()
    status = .idle
    latestFrame = nil
    overlayFrame = .empty
    statusText = "Starting recognition"
    current = nil
    missingRecognitionOutputs = 0
    transcript.removeAll(keepingCapacity: true)
    speech.reset()
    await recognizer.stop()
    await stream?.stop()
    session?.stop()
  }
}
