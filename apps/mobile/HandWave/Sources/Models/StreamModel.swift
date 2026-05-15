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
  var errorMessage: String?

  private let wearables: WearablesInterface
  private let selector: AutoDeviceSelector
  private var session: DeviceSession?
  private var stream: StreamSession?
  private var stateToken: AnyListenerToken?
  private var frameToken: AnyListenerToken?

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.selector = AutoDeviceSelector(wearables: wearables)
  }

  var isStreaming: Bool { status == .streaming }

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
        if state == .streaming { self.status = .streaming }
      }
    }

    frameToken = stream.videoFramePublisher.listen { [weak self] frame in
      guard let image = frame.makeUIImage() else { return }
      Task { @MainActor [weak self] in
        self?.latestFrame = image
      }
    }

    await stream.start()
  }

  private func teardown() async {
    let stream = self.stream
    let session = self.session
    self.stream = nil
    self.session = nil
    stateToken = nil
    frameToken = nil
    status = .idle
    latestFrame = nil
    await stream?.stop()
    session?.stop()
  }
}
