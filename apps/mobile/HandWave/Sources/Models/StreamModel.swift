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
  private(set) var statusText = "Starting"
  private(set) var current: InferSession.Pred?
  private(set) var isSpeaking = false
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
  private var startError: DeviceSessionError?
  @ObservationIgnored
  private var streamStarted = false
  @ObservationIgnored
  private var isTearingDown = false
  @ObservationIgnored
  private var emptyReads = 0
  private static let emptyReadGrace = 4

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.selector = AutoDeviceSelector(wearables: wearables)
    self.speech.onSpeakingChanged = { [weak self] speaking in
      self?.isSpeaking = speaking
    }
  }

  var isStreaming: Bool { status == .streaming }
  var isActive: Bool { status != .idle }

  func observe() async {
    refresh()
    for await device in selector.activeDeviceStream() {
      hasActiveDevice = device != nil
    }
  }

  func refresh() {
    hasActiveDevice = selector.activeDevice != nil
  }

  func start() async {
    guard status == .idle else { return }
    guard hasActiveDevice else {
      failure = .noActiveDevice
      return
    }
    status = .connecting
    do {
      let session = try wearables.createSession(deviceSelector: selector)
      self.session = session

      let stateStream = session.stateStream()
      observeSessionErrors(session)
      // The SDK can emit `.started` synchronously during `start()`.
      try session.start()

      for await state in stateStream {
        switch state {
        case .started:
          await openStream(on: session)
          return
        case .stopped:
          failure = .sessionEndedEarly(self.startError)
          await teardown()
          return
        case .idle, .starting, .paused, .stopping:
          break
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
    speech.prepare()

    let config = MWDATCamera.StreamConfiguration(
      videoCodec: .raw,
      resolution: .low,
      frameRate: UInt(InferCfg.Stream.fps)
    )
    let stream: MWDATCamera.Stream
    do {
      guard let opened = try session.addStream(config: config) else {
        failure = .streamConfigRejected
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
          self.streamStarted = true
          self.status = .streaming
        case .stopped:
          guard self.streamStarted else { return }
          Task { await self.teardown() }
        case .waitingForDevice, .starting, .paused, .stopping:
          self.streamStarted = true
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
                self?.failure = .recognitionFailed(error)
              }
            }
            await frameGate.finishRecognition()
          }
        }
      }
    }

    stream.start()
  }

  private func observeSessionErrors(_ session: DeviceSession) {
    let errorStream = session.errorStream()
    sessionErrorTask = Task { [weak self] in
      for await error in errorStream {
        await MainActor.run {
          guard let self, self.status != .idle else { return }
          self.startError = error
          if error.stopsSession {
            self.failure = .sessionRuntimeFailed(error)
          }
        }
      }
    }
  }

  private func statusText(for output: Recognizer.Output) -> String {
    if let failure = output.failure { return failure.statusDescription }
    if output.hasFrame {
      emptyReads = 0
      return "Reading"
    }

    emptyReads += 1
    if emptyReads < Self.emptyReadGrace,
      current != nil || statusText == "Reading"
    {
      return statusText
    }

    return output.overlayFrame.isEmpty ? "Show your hands" : "Center your hands"
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
    guard !isTearingDown else { return }
    isTearingDown = true

    let stream = self.stream
    let session = self.session
    stateToken = nil
    frameToken = nil
    errorToken = nil
    sessionErrorTask?.cancel()
    sessionErrorTask = nil
    startError = nil

    await recognizer.stop()
    stream?.stop()
    session?.stop()

    self.stream = nil
    self.session = nil
    await frameGate.reset()
    streamStarted = false
    status = .idle
    latestFrame = nil
    overlayFrame = .empty
    statusText = "Starting"
    current = nil
    isSpeaking = false
    emptyReads = 0
    transcript.removeAll(keepingCapacity: true)
    speech.reset()
    isTearingDown = false
  }
}
