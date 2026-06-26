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
  var failure: StreamFailure?

  @ObservationIgnored
  @Dependency(\.recognizer) private var recognizer

  @ObservationIgnored
  private let wearables: WearablesInterface
  @ObservationIgnored
  private let selector: AutoDeviceSelector
  @ObservationIgnored
  private let speech = Speech()
  @ObservationIgnored
  private let frameGate = FrameGate(
    previewFPS: Double(InferCfg.Stream.fps),
    recognitionFPS: min(12, Double(InferCfg.Stream.fps))
  )
  @ObservationIgnored
  private var session: DeviceSession?
  @ObservationIgnored
  private var stream: MWDATCamera.Stream?
  @ObservationIgnored
  private var stateToken: AnyListenerToken?
  @ObservationIgnored
  private var frameToken: AnyListenerToken?
  @ObservationIgnored
  private var errorToken: AnyListenerToken?
  @ObservationIgnored
  private var sessionErrorTask: Task<Void, Never>?
  @ObservationIgnored
  private var startupSessionError: DeviceSessionError?
  @ObservationIgnored
  private var activeDeviceAvailableSince: Date?
  @ObservationIgnored
  private var streamHasStarted = false
  @ObservationIgnored
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
      let isActive = device != nil
      if isActive, !hasActiveDevice {
        activeDeviceAvailableSince = Date()
      } else if !isActive {
        activeDeviceAvailableSince = nil
      }
      hasActiveDevice = isActive
    }
  }

  func start() async {
    guard status == .idle else { return }
    await waitForActiveDeviceToSettle()
    guard hasActiveDevice else {
      failure = .noActiveDevice
      return
    }
    status = .connecting
    do {
      let session = try wearables.createSession(deviceSelector: selector)
      self.session = session

      // Subscribe to the state stream *before* starting the session so we
      // don't miss the synchronous `.started` event the SDK emits.
      let stateStream = session.stateStream()
      observeSessionErrors(session)
      try session.start()

      for await sessionState in stateStream {
        if sessionState == .started {
          await openStream(on: session)
          return
        } else if sessionState == .stopped {
          failure = .sessionStoppedBeforeStart(startupSessionError)
          await teardown()
          return
        }
      }
    } catch {
      failure = .sessionStartFailed(error)
      await teardown()
    }
  }

  func stop() async {
    await teardown()
  }

  private func openStream(on session: DeviceSession) async {
    speech.prepareForStreaming()

    let config = MWDATCamera.StreamConfiguration(
      videoCodec: .raw,
      resolution: .low,
      frameRate: UInt(InferCfg.Stream.fps)
    )
    let stream: MWDATCamera.Stream
    do {
      guard let opened = try session.addStream(config: config) else {
        failure = .streamRejectedConfiguration
        await teardown()
        return
      }
      stream = opened
    } catch {
      failure = .streamOpenFailed(error)
      await teardown()
      return
    }
    self.stream = stream

    do {
      try await recognizer.start()
    } catch {
      failure = .recognitionStartFailed(error)
      await teardown()
      return
    }

    stateToken = stream.statePublisher.listen { [weak self] (state: MWDATCamera.StreamState) in
      Task { @MainActor [weak self] in
        guard let self else { return }
        switch state {
        case .streaming:
          self.streamHasStarted = true
          self.status = .streaming
        case .stopped:
          guard self.streamHasStarted else { return }
          Task { await self.teardown() }
        case .waitingForDevice, .starting, .paused, .stopping:
          self.streamHasStarted = true
          self.status = .connecting
        }
      }
    }

    errorToken = stream.errorPublisher.listen { [weak self] (error: MWDATCamera.StreamError) in
      Task { @MainActor [weak self] in
        self?.failure = .streamRuntimeFailed(String(describing: error))
        await self?.teardown()
      }
    }

    let frameGate = frameGate
    frameToken = stream.videoFramePublisher.listen {
      [weak self, recognizer, frameGate] (frame: MWDATCamera.VideoFrame) in
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
                self?.failure = .recognitionProcessingFailed(error)
              }
            }
            await frameGate.finishRecognition()
          }
        }
      }
    }

    await stream.start()
  }

  private func observeSessionErrors(_ session: DeviceSession) {
    let errorStream = session.errorStream()
    sessionErrorTask = Task { [weak self] in
      for await error in errorStream {
        await MainActor.run {
          guard let self, self.status != .idle else { return }
          self.startupSessionError = error
          if error.requiresImmediateSessionStop {
            self.failure = .sessionRuntimeFailed(error)
          }
        }
      }
    }
  }

  private func waitForActiveDeviceToSettle() async {
    guard let activeDeviceAvailableSince else { return }
    let elapsed = Date().timeIntervalSince(activeDeviceAvailableSince)
    let remaining = 2.0 - elapsed
    if remaining > 0 {
      try? await Task.sleep(for: .milliseconds(Int(remaining * 1_000)))
    }
  }

  private func statusText(for output: Recognizer.Output) -> String {
    if let failure = output.failure { return "Backend: \(failure.statusDescription)" }
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
    sessionErrorTask?.cancel()
    sessionErrorTask = nil
    startupSessionError = nil
    streamHasStarted = false
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
