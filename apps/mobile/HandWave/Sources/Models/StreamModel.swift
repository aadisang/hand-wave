import AVFoundation
import MWDATCamera
import MWDATCore
import Observation
import UIKit

enum StreamFailure: Error, LocalizedError, Sendable {
  case noGlasses
  case session(String)
  case camera(String)
  case recognition(String)

  static func ended(_ error: DeviceSessionError?) -> Self {
    .session(error.map(message) ?? "Glasses stopped before streaming. Keep them open nearby.")
  }

  static func stopped(_ error: DeviceSessionError) -> Self {
    .session(message(error))
  }

  var errorDescription: String? {
    switch self {
    case .noGlasses: "No glasses ready."
    case .session(let message), .camera(let message), .recognition(let message): message
    }
  }

  private static func message(_ error: DeviceSessionError) -> String {
    switch error {
    case .noEligibleDevice: "No glasses ready. Open or wear them nearby."
    case .sessionAlreadyStopped: "Session already stopped. Try again."
    case .sessionAlreadyExists: "Another session is active."
    case .sessionIdle: "Session stayed idle. Reopen glasses."
    case .capabilityAlreadyActive: "Camera already in use."
    case .capabilityNotFound: "Camera unavailable. Try again."
    case .unexpectedError(let description): description
    case .thermalCritical: "Glasses too warm."
    case .thermalEmergency: "Glasses overheated."
    case .peakPowerShutdown: "Glasses need charging."
    case .batteryCritical: "Glasses battery low."
    case .datAppOnTheGlassesUpdateRequired: "Update DAT in Meta AI."
    case .dwaUnavailable: "DAT unavailable. Reconnect in Meta AI."
    }
  }
}

extension DeviceSessionError {
  fileprivate var stopsSession: Bool {
    switch self {
    case .thermalCritical, .thermalEmergency, .peakPowerShutdown, .batteryCritical,
      .datAppOnTheGlassesUpdateRequired:
      true
    default:
      false
    }
  }
}

@MainActor
@Observable
final class StreamModel {
  enum Status: Sendable {
    case idle
    case connecting
    case streaming
  }

  enum Source: String, CaseIterable, Identifiable, Sendable {
    case glasses
    case phone

    var id: Self { self }
    var title: String { self == .glasses ? "Glasses" : "Phone" }
  }

  private enum Lifecycle: Sendable {
    case idle
    case connecting(Source)
    case streaming(Source)
  }

  var source: Source = .glasses
  private var lifecycle: Lifecycle = .idle
  private(set) var hasActiveDevice = false
  private(set) var latestFrame: UIImage?
  private(set) var overlayFrame = LandmarkOverlayFrame.empty
  private(set) var current: Prediction?
  private(set) var speakingText: String?
  private(set) var isPreparingLandmarks = false
  private(set) var framingMessage: String?
  private(set) var backendMessage: String?
  var failure: StreamFailure?

  @ObservationIgnored private let wearables: WearablesInterface
  @ObservationIgnored private let selector: AutoDeviceSelector
  @ObservationIgnored private let phoneCamera = PhoneCamera()
  @ObservationIgnored private let pipeline = FramePipeline()
  @ObservationIgnored private let speech = SpeechCoordinator()
  @ObservationIgnored private let wearableDiagnostics: WearableDiagnosticsObserver
  @ObservationIgnored private var deviceSession: DeviceSession?
  @ObservationIgnored private var glassesStream: MWDATCamera.Stream?
  @ObservationIgnored private var stateToken: AnyListenerToken?
  @ObservationIgnored private var frameToken: AnyListenerToken?
  @ObservationIgnored private var errorToken: AnyListenerToken?
  @ObservationIgnored private var sessionErrorTask: Task<Void, Never>?
  @ObservationIgnored private var frameTask: Task<Void, Never>?
  @ObservationIgnored private var prewarmTask: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var isStopping = false
  @ObservationIgnored private var streamStarted = false
  @ObservationIgnored private var startError: DeviceSessionError?
  @ObservationIgnored private var datUpdateGeneration: Int?
  @ObservationIgnored private var diagnostics = StreamDiagnosticState()

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.selector = AutoDeviceSelector(wearables: wearables)
    self.wearableDiagnostics = WearableDiagnosticsObserver(wearables: wearables)
    speech.onSpeakingTextChanged = { [weak self] in self?.speakingText = $0 }
  }

  var status: Status {
    switch lifecycle {
    case .idle: .idle
    case .connecting: .connecting
    case .streaming: .streaming
    }
  }
  var activeSource: Source? {
    switch lifecycle {
    case .idle: nil
    case .connecting(let source), .streaming(let source): source
    }
  }
  var isStreaming: Bool { status == .streaming }
  var isActive: Bool { status != .idle }
  var phoneSession: AVCaptureSession { phoneCamera.session }
  func observe() async {
    if prewarmTask == nil {
      prewarmTask = Task(priority: .utility) { [pipeline] in
        let startedAt = ContinuousClock.now
        AppLog.inference.notice("MediaPipe prewarm started")
        do {
          try await pipeline.prepare()
          AppLog.inference.notice(
            "MediaPipe prewarm completed elapsed_ms=\(milliseconds(from: startedAt))"
          )
        } catch {
          AppLog.inference.error(
            "MediaPipe prewarm failed error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
          )
        }
      }
    }
    refresh()
    for await device in selector.activeDeviceStream() {
      hasActiveDevice = device != nil
      diagnostics.replaceDevice()
      await wearableDiagnostics.select(device) { [weak self] level in
        self?.diagnostics.record(thermalLevel: level) ?? false
      }
    }
  }

  func refresh() {
    let available = selector.activeDevice != nil
    guard available != hasActiveDevice else { return }
    hasActiveDevice = available
    AppLog.wearables.notice("Glasses availability changed available=\(available)")
  }

  func start() async {
    guard status == .idle, !isStopping else {
      AppLog.stream.info(
        "Ignored stream start status=\(self.status.diagnosticName, privacy: .public) stopping=\(self.isStopping)"
      )
      return
    }
    failure = nil
    generation &+= 1
    let run = generation
    diagnostics.begin()
    lifecycle = .connecting(source)
    isPreparingLandmarks = true
    AppLog.stream.notice(
      "Stream start requested run=\(run) source=\(self.source.rawValue, privacy: .public) glasses_available=\(self.hasActiveDevice) thermal=\(self.diagnostics.thermalLevelName, privacy: .public)"
    )

    do {
      try await preparePipeline(for: run)
      guard isCurrent(run) else { return }
      switch source {
      case .glasses:
        try await startGlasses(run: run)
      case .phone:
        try await startPhone(run: run)
      }
    } catch is CancellationError {
      guard generation == run else { return }
      AppLog.stream.notice("Stream start cancelled run=\(run)")
      await stop(reason: .startCancelled)
    } catch {
      guard generation == run else { return }
      let failure = error as? StreamFailure ?? .camera(error.localizedDescription)
      AppLog.stream.error(
        "Stream start failed run=\(run) error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
      await stop(reason: .startupFailed)
      self.failure = failure
    }
  }

  func rotateCamera() async {
    guard activeSource == .phone else { return }
    do {
      _ = try await phoneCamera.rotate()
      AppLog.camera.notice("Phone camera rotated")
    } catch {
      failure = .camera(error.localizedDescription)
      AppLog.camera.error(
        "Phone camera rotation failed: \(error.localizedDescription, privacy: .private)"
      )
    }
  }

  func stop(reason: StreamStopReason = .requested) async {
    guard status != .idle, !isStopping else {
      AppLog.stream.info(
        "Ignored stream stop reason=\(reason.diagnosticName, privacy: .public) status=\(self.status.diagnosticName, privacy: .public) stopping=\(self.isStopping)"
      )
      return
    }
    isStopping = true
    let run = generation
    let stoppedSource = activeSource ?? source
    let elapsedMilliseconds = diagnostics.elapsedMilliseconds()
    let sessionState = diagnostics.sessionStateName
    let streamState = diagnostics.streamStateName
    let thermalLevel = diagnostics.thermalLevelName
    generation &+= 1

    stateToken = nil
    frameToken = nil
    errorToken = nil
    sessionErrorTask?.cancel()
    frameTask?.cancel()
    sessionErrorTask = nil
    frameTask = nil

    let stream = glassesStream
    let session = deviceSession
    glassesStream = nil
    deviceSession = nil
    streamStarted = false
    startError = nil

    await phoneCamera.stop()
    let stats = await pipeline.stop()
    stream?.stop()
    session?.stop()

    latestFrame = nil
    overlayFrame = .empty
    current = nil
    speakingText = nil
    isPreparingLandmarks = false
    framingMessage = nil
    backendMessage = nil
    speech.reset()
    lifecycle = .idle
    isStopping = false
    diagnostics.end()
    AppLog.stream.notice(
      "Stream stopped run=\(run) source=\(stoppedSource.rawValue, privacy: .public) reason=\(reason.diagnosticName, privacy: .public) elapsed_ms=\(elapsedMilliseconds) frames_received=\(stats.receivedFrames) frames_processed=\(stats.processedFrames) inference_frames=\(stats.inferenceFrames) superseded_frames=\(stats.supersededFrames) session_state=\(sessionState, privacy: .public) camera_state=\(streamState, privacy: .public) thermal=\(thermalLevel, privacy: .public)"
    )
  }

  private func preparePipeline(for run: Int) async throws {
    let startedAt = ContinuousClock.now
    AppLog.stream.notice("Preparing recognition pipeline run=\(run)")
    do {
      try await pipeline.start(
        onPreview: { [weak self] image in
          guard self?.isCurrent(run) == true else { return }
          self?.latestFrame = image
        },
        onOutput: { [weak self] output in
          guard self?.isCurrent(run) == true else { return }
          self?.apply(output)
        },
        onEvent: { [weak self] event in
          guard self?.isCurrent(run) == true else { return }
          self?.apply(event)
        },
        onFailure: { [weak self] message in
          guard self?.isCurrent(run) == true else { return }
          self?.failure = .recognition(message)
          AppLog.inference.error(
            "Recognition pipeline failure run=\(run) message=\(message, privacy: .private)"
          )
        }
      )
      AppLog.stream.notice(
        "Recognition pipeline ready run=\(run) elapsed_ms=\(milliseconds(from: startedAt))"
      )
    } catch {
      AppLog.stream.error(
        "Recognition pipeline setup failed run=\(run) elapsed_ms=\(milliseconds(from: startedAt)) error_type=\(String(reflecting: type(of: error)), privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
      throw error
    }
  }

  private func startPhone(run: Int) async throws {
    AppLog.camera.notice("Phone camera start requested run=\(run) position=back")
    let frames = try await phoneCamera.start(position: .back)
    guard isCurrent(run) else {
      await phoneCamera.stop()
      return
    }
    lifecycle = .streaming(.phone)
    AppLog.stream.notice(
      "Phone stream started run=\(run) elapsed_ms=\(self.diagnostics.elapsedMilliseconds())"
    )

    frameTask = Task { [weak self] in
      guard let self else { return }
      for await frame in frames {
        guard isCurrent(run), !Task.isCancelled else { return }
        await pipeline.submit(.phone(frame))
      }
    }
  }

  private func startGlasses(run: Int) async throws {
    guard let deviceIdentifier = selector.activeDevice else {
      throw StreamFailure.noGlasses
    }
    if let device = wearables.deviceForIdentifier(deviceIdentifier) {
      AppLog.stream.notice(
        "Creating glasses session run=\(run) link=\(device.linkState.diagnosticName, privacy: .public) compatibility=\(device.compatibility().diagnosticName, privacy: .public) thermal=\(self.diagnostics.thermalLevelName, privacy: .public)"
      )
    } else {
      AppLog.stream.notice(
        "Creating glasses session run=\(run) device_details=unavailable thermal=\(self.diagnostics.thermalLevelName, privacy: .public)"
      )
    }
    let session = try wearables.createSession(deviceSelector: selector)
    deviceSession = session
    let states = session.stateStream()
    observeSessionErrors(session, run: run)

    do {
      try session.start()
      AppLog.stream.notice("Glasses session start accepted run=\(run)")
    } catch let error {
      AppLog.stream.error(
        "Glasses session start rejected run=\(run) case=\(error.diagnosticName, privacy: .public) message=\(error.localizedDescription, privacy: .private)"
      )
      guard case .datAppOnTheGlassesUpdateRequired = error else { throw error }
      await openDATGlassesAppUpdate(run: run)
      throw StreamFailure.stopped(error)
    }
    for await state in states {
      guard isCurrent(run), !Task.isCancelled else { return }
      diagnostics.record(sessionState: state)
      AppLog.stream.notice(
        "Glasses session state run=\(run) state=\(state.diagnosticName, privacy: .public) elapsed_ms=\(self.diagnostics.elapsedMilliseconds())"
      )
      switch state {
      case .started:
        try await openGlassesStream(session, run: run)
        return
      case .stopped:
        throw StreamFailure.ended(startError)
      case .idle, .starting, .paused, .stopping:
        break
      }
    }
  }

  private func openGlassesStream(_ session: DeviceSession, run: Int) async throws {
    let configuration = MWDATCamera.StreamConfiguration(
      videoCodec: .raw,
      resolution: .low,
      frameRate: 30
    )
    AppLog.stream.notice(
      "Adding glasses camera stream run=\(run) codec=raw resolution=low fps=30"
    )
    guard let stream = try session.addStream(config: configuration) else {
      throw StreamFailure.camera("Stream settings rejected.")
    }
    glassesStream = stream
    AppLog.stream.notice("Glasses camera stream added run=\(run)")

    stateToken = stream.statePublisher.listen { [weak self] state in
      Task { @MainActor [weak self] in
        guard let self, isCurrent(run) else { return }
        diagnostics.record(streamState: state)
        AppLog.stream.notice(
          "Glasses camera state run=\(run) state=\(state.diagnosticName, privacy: .public) elapsed_ms=\(self.diagnostics.elapsedMilliseconds())"
        )
        switch state {
        case .streaming:
          streamStarted = true
          lifecycle = .streaming(.glasses)
        case .stopped where streamStarted:
          await stop(reason: .streamStateStopped)
        case .waitingForDevice, .starting, .paused, .stopping:
          streamStarted = true
          lifecycle = .connecting(.glasses)
        case .stopped:
          break
        }
      }
    }

    errorToken = stream.errorPublisher.listen { [weak self] error in
      Task { @MainActor [weak self] in
        guard let self, isCurrent(run) else { return }
        AppLog.stream.fault(
          "Glasses camera error run=\(run) case=\(error.diagnosticName, privacy: .public) message=\(error.localizedDescription, privacy: .private) elapsed_ms=\(self.diagnostics.elapsedMilliseconds()) session_state=\(self.diagnostics.sessionStateName, privacy: .public) camera_state=\(self.diagnostics.streamStateName, privacy: .public) thermal=\(self.diagnostics.thermalLevelName, privacy: .public)"
        )
        await stop(reason: .streamError(error))
        failure = .camera(error.localizedDescription)
      }
    }

    let frames = AsyncStream.makeStream(
      of: MWDATCamera.VideoFrame.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    frameToken = stream.videoFramePublisher.listen { frame in
      frames.continuation.yield(frame)
    }
    frameTask = Task { [weak self] in
      guard let self else { return }
      for await frame in frames.stream {
        guard isCurrent(run), !Task.isCancelled else { return }
        await pipeline.submit(.glasses(frame))
      }
    }

    stream.start()
    AppLog.stream.notice(
      "Glasses stream requested run=\(run) fps=30 elapsed_ms=\(self.diagnostics.elapsedMilliseconds())"
    )
  }

  private func observeSessionErrors(_ session: DeviceSession, run: Int) {
    sessionErrorTask = Task { [weak self] in
      guard let self else { return }
      for await error in session.errorStream() {
        guard isCurrent(run), !Task.isCancelled else { return }
        startError = error
        AppLog.stream.error(
          "Glasses session error run=\(run) case=\(error.diagnosticName, privacy: .public) terminal=\(error.stopsSession) message=\(error.localizedDescription, privacy: .private) elapsed_ms=\(self.diagnostics.elapsedMilliseconds()) session_state=\(self.diagnostics.sessionStateName, privacy: .public) camera_state=\(self.diagnostics.streamStateName, privacy: .public) thermal=\(self.diagnostics.thermalLevelName, privacy: .public)"
        )
        guard error.stopsSession else { continue }
        if case .datAppOnTheGlassesUpdateRequired = error {
          await openDATGlassesAppUpdate(run: run)
        }
        await stop(reason: .sessionError(error))
        failure = .stopped(error)
      }
    }
  }

  private func openDATGlassesAppUpdate(run: Int) async {
    guard datUpdateGeneration != run else { return }
    datUpdateGeneration = run
    do {
      try await wearables.openDATGlassesAppUpdate()
      AppLog.stream.notice("Opened DAT glasses app update")
    } catch {
      AppLog.stream.error(
        "Failed to open DAT glasses app update: \(error.localizedDescription, privacy: .private)"
      )
    }
  }

  private func apply(_ output: RecognitionOutput) {
    isPreparingLandmarks = false
    if overlayFrame != output.overlay {
      overlayFrame = output.overlay
    }
    backendMessage =
      output.backendFailure.flatMap { failure in
        switch failure {
        case .badStatus(_, let status): "Backend HTTP \(status)"
        case .cancelled: nil
        default: "Backend warming up"
        }
      } ?? nil
    let nextFramingMessage =
      output.needsPose
      ? "Stand back."
      : nil
    if framingMessage != nextFramingMessage {
      framingMessage = nextFramingMessage
    }
    if let event = output.event {
      apply(event)
    }
  }

  private func apply(_ event: RecognitionEvent) {
    switch event {
    case .clear:
      current = nil
    case .partial(let prediction), .finalized(let prediction):
      guard prediction.isMeaningful else {
        current = nil
        return
      }
      current = prediction
    }
    speech.handle(event)
  }

  private func isCurrent(_ run: Int) -> Bool {
    run == generation && status != .idle
  }

}

extension StreamModel.Status {
  fileprivate var diagnosticName: String {
    switch self {
    case .idle: "idle"
    case .connecting: "connecting"
    case .streaming: "streaming"
    }
  }
}
