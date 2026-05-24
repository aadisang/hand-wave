import Foundation
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
  private(set) var overlayLandmarks: [LandmarkPoint] = []
  private(set) var statusText = "Starting recognition"
  private(set) var current: InferSession.Pred?
  private(set) var transcript: [InferSession.Pred] = []
  var errorMessage: String?

  private let wearables: WearablesInterface
  private let selector: AutoDeviceSelector
  private let recognizer = Recognizer()
  private let speech = Speech()
  private var session: DeviceSession?
  private var stream: StreamSession?
  private var stateToken: AnyListenerToken?
  private var frameToken: AnyListenerToken?
  private var errorToken: AnyListenerToken?
  private var busy = false

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
    let config = StreamSessionConfig(
      videoCodec: .raw,
      resolution: .medium,
      frameRate: 24
    )
    let stream: StreamSession
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

    frameToken = stream.videoFramePublisher.listen { [weak self] frame in
      let image = frame.makeUIImage()
      Task { @MainActor [weak self] in
        guard let self else { return }
        if let image {
          self.latestFrame = image
        }
        self.process(frame)
      }
    }

    await stream.start()
    warmRecognizer()
  }

  private func warmRecognizer() {
    Task { [weak self, recognizer] in
      do {
        try await recognizer.start()
      } catch {
        await MainActor.run {
          if self?.errorMessage == nil {
            self?.errorMessage = "Recognition failed: \(error.localizedDescription)"
          }
        }
      }
    }
  }

  private func process(_ frame: VideoFrame) {
    guard !busy else { return }
    busy = true

    Task { [weak self, recognizer] in
      do {
        let output = try await recognizer.process(frame)
        await MainActor.run {
          self?.overlayLandmarks = output.overlayLandmarks
          if let error = output.error {
            self?.statusText = "Backend: \(error)"
          } else {
            self?.statusText =
              output.hasFrame
              ? "Reading sign"
              : output.overlayLandmarks.isEmpty
                ? "Looking for hand and body"
                : "Need hand and body in frame"
          }
          self?.apply(output.event)
          self?.busy = false
        }
      } catch {
        await MainActor.run {
          self?.statusText = "Recognition failed: \(error.localizedDescription)"
          self?.busy = false
        }
      }
    }
  }

  private func apply(_ event: InferSession.Event?) {
    guard let event else { return }
    switch event {
    case .clear:
      current = nil
    case .partial(let prediction):
      current = prediction
    case .finalized(let prediction):
      current = prediction
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
    busy = false
    status = .idle
    latestFrame = nil
    overlayLandmarks.removeAll(keepingCapacity: true)
    statusText = "Starting recognition"
    current = nil
    transcript.removeAll(keepingCapacity: true)
    speech.reset()
    await recognizer.stop()
    await stream?.stop()
    session?.stop()
  }
}
