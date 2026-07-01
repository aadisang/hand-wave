import AVFoundation
import Dependencies
import MWDATCamera
import MWDATCore
import Observation
import UIKit

@MainActor
@Observable
final class StreamModel {
  enum Status { case idle, connecting, streaming }
  private static let glassesFrameRate = 30.0

  private enum SpeechLogEvent: String, Encodable {
    case clear
    case finalizedSeen
    case partialRejected
    case partialSeen
    case pendingBlocked
    case pendingCanceled
    case pendingFired
    case pendingScheduled
    case speechEnded
    case speechRequested
    case speechStarted
  }

  private struct SpeechLogEntry: Encodable {
    let timestamp: Date
    let event: SpeechLogEvent
    let reason: String?
    let source: String
    let status: String
    let text: String?
    let confidence: Double?
    let processingTimeMs: Double?
    let currentText: String?
    let pendingText: String?
    let spokenText: String?
  }

  private struct SpeechLogExport: Encodable {
    let createdAt: Date
    let speechDelayMs: Int
    let partialSpeechConfidence: Double
    let entries: [SpeechLogEntry]
  }

  enum Source: String, CaseIterable, Identifiable {
    case glasses
    case phone

    var id: Self { self }

    var title: String {
      switch self {
      case .glasses: "Glasses"
      case .phone: "Phone"
      }
    }

  }

  var source: Source = .glasses
  private(set) var status: Status = .idle
  private(set) var activeSource: Source?
  private(set) var hasActiveDevice: Bool = false
  private(set) var latestFrame: UIImage?
  private(set) var overlayFrame = HandLandmarksFrame.empty
  private(set) var statusText = "Starting"
  private(set) var current: InferSession.Pred?
  private(set) var isSpeaking = false
  private(set) var transcript: [InferSession.Pred] = []
  private(set) var speechLogCount = 0
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
  private let phoneCamera = PhoneCamera()
  @ObservationIgnored
  private let frameGate = FrameGate(
    previewFPS: StreamModel.glassesFrameRate,
    recognitionFPS: StreamModel.glassesFrameRate
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
  @ObservationIgnored
  private var pendingSpeechTask: Task<Void, Never>?
  @ObservationIgnored
  private var pendingSpeechText: String?
  @ObservationIgnored
  private var spokenText: String?
  @ObservationIgnored
  private var speechLog: [SpeechLogEntry] = []
  private static let emptyReadGrace = 4
  private static let maxSpeechLogEntries = 1_000
  private static let speechDelay: Duration = .milliseconds(950)
  private static let speechDelayMs = 950
  private static let partialSpeechConfidence = 0.6
  private(set) var phonePosition: PhoneCamera.Position = .back

  init(wearables: WearablesInterface) {
    self.wearables = wearables
    self.selector = AutoDeviceSelector(wearables: wearables)
    self.speech.onSpeakingChanged = { [weak self] speaking in
      self?.isSpeaking = speaking
      self?.logSpeech(speaking ? .speechStarted : .speechEnded)
    }
  }

  var isStreaming: Bool { status == .streaming }
  var isActive: Bool { status != .idle }
  var isPhoneCameraActive: Bool { activeSource == .phone }
  var phoneSession: AVCaptureSession { phoneCamera.session }

  func observe() async {
    refresh()
    let poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(500))
        self?.refresh()
      }
    }
    defer { poll.cancel() }

    for await device in selector.activeDeviceStream() {
      hasActiveDevice = device != nil
    }
  }

  func refresh() {
    hasActiveDevice = selector.activeDevice != nil
  }

  func prewarmRecognition() async {
    guard status == .idle else { return }
    try? await recognizer.start()
  }

  func start() async {
    switch source {
    case .glasses:
      await startGlasses()
    case .phone:
      await startPhone()
    }
  }

  func rotateCamera() async {
    guard activeSource == .phone else { return }
    do {
      let (position, frameRate) = try await phoneCamera.rotate()
      phonePosition = position
      await setFrameRate(frameRate)
    } catch {
      failure = .camera(error.localizedDescription)
    }
  }

  func stop() async {
    await teardown()
  }

  func clearSpeechLog() {
    speechLog.removeAll(keepingCapacity: true)
    speechLogCount = 0
  }

  func exportSpeechLog() throws -> URL {
    let export = SpeechLogExport(
      createdAt: Date(),
      speechDelayMs: Self.speechDelayMs,
      partialSpeechConfidence: Self.partialSpeechConfidence,
      entries: speechLog
    )
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    let url = FileManager.default.temporaryDirectory
      .appending(path: "hand-wave-speech-\(Int(Date().timeIntervalSince1970)).json")
    try encoder.encode(export).write(to: url, options: .atomic)
    return url
  }

  private func startGlasses() async {
    guard status == .idle else { return }
    guard hasActiveDevice else {
      failure = .noGlasses
      return
    }
    activeSource = .glasses
    status = .connecting
    await setFrameRate(Self.glassesFrameRate)
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
          failure = .ended(self.startError)
          await teardown()
          return
        case .idle, .starting, .paused, .stopping:
          break
        }
      }
    } catch {
      failure = .session(error.localizedDescription)
      await teardown()
    }
  }

  private func startPhone() async {
    guard status == .idle else { return }
    activeSource = .phone
    status = .connecting
    do {
      try await recognizer.start()
      let frameRate = try await phoneCamera.start(position: phonePosition) { [weak self] frame in
        Task { @MainActor [weak self] in
          await self?.processCamera(frame)
        }
      }
      await setFrameRate(frameRate)
      status = .streaming
    } catch {
      failure = .camera(error.localizedDescription)
      await teardown()
    }
  }

  private func openStream(on session: DeviceSession) async {
    let config = MWDATCamera.StreamConfiguration(
      videoCodec: .raw,
      resolution: .low,
      frameRate: UInt(Self.glassesFrameRate)
    )
    let stream: MWDATCamera.Stream
    do {
      guard let opened = try session.addStream(config: config) else {
        failure = .camera("Stream settings rejected.")
        await teardown()
        return
      }
      stream = opened
    } catch {
      failure = .camera(error.localizedDescription)
      await teardown()
      return
    }
    self.stream = stream

    do {
      try await recognizer.start()
    } catch {
      failure = .recognition(error.localizedDescription)
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
        self?.failure = .camera(error.localizedDescription)
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
                self?.failure = .recognition(error.localizedDescription)
              }
            }
            await frameGate.finishRecognition()
          }
        }
      }
    }

    stream.start()
  }

  private func processCamera(_ frame: CameraFrame) async {
    guard activeSource == .phone, status != .idle else { return }
    let decision = await frameGate.accept()
    guard decision.hasWork else { return }

    if decision.preview {
      await frameGate.finishPreview()
    }

    guard decision.recognition else { return }
    let frameGate = frameGate
    Task(priority: .utility) { [weak self, recognizer, frameGate] in
      do {
        let output = try await recognizer.processCamera(frame)
        await MainActor.run {
          guard self?.status != .idle else { return }
          self?.apply(output)
        }
      } catch {
        await MainActor.run {
          guard self?.status != .idle else { return }
          self?.failure = .recognition(error.localizedDescription)
        }
      }
      await frameGate.finishRecognition()
    }
  }

  private func setFrameRate(_ frameRate: Double) async {
    await frameGate.setFrameRate(frameRate)
    await recognizer.setFrameRate(frameRate)
  }

  private func observeSessionErrors(_ session: DeviceSession) {
    let errorStream = session.errorStream()
    sessionErrorTask = Task { [weak self] in
      for await error in errorStream {
        await MainActor.run {
          guard let self, self.status != .idle else { return }
          self.startError = error
          if error.stopsSession {
            self.failure = .stopped(error)
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
      logSpeech(.clear)
      if current != nil {
        current = nil
      }
      cancelPendingSpeech(reason: "clear")
      spokenText = nil
    case .partial(let prediction):
      logSpeech(.partialSeen, prediction: prediction)
      if current != prediction {
        current = prediction
      }
      scheduleSpeech(prediction)
    case .finalized(let prediction):
      logSpeech(.finalizedSeen, prediction: prediction)
      if current != prediction {
        current = prediction
      }
      cancelPendingSpeech(reason: "finalized")
      speak(prediction)
    }
  }

  private func scheduleSpeech(_ prediction: InferSession.Pred) {
    let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      logSpeech(.partialRejected, prediction: prediction, reason: "empty_text")
      return
    }
    guard text != spokenText else {
      logSpeech(.partialRejected, prediction: prediction, reason: "already_spoken")
      return
    }
    guard prediction.confidence >= Self.partialSpeechConfidence else {
      logSpeech(.partialRejected, prediction: prediction, reason: "low_confidence")
      cancelPendingSpeech(reason: "low_confidence")
      return
    }
    guard text != pendingSpeechText else {
      logSpeech(.partialRejected, prediction: prediction, reason: "already_pending")
      return
    }

    cancelPendingSpeech(reason: "replaced_by_new_partial")
    pendingSpeechText = text
    logSpeech(.pendingScheduled, prediction: prediction)
    pendingSpeechTask = Task { [weak self] in
      do {
        try await Task.sleep(for: Self.speechDelay)
      } catch {
        return
      }
      self?.finishPendingSpeech(text: text, prediction: prediction)
    }
  }

  private func speak(_ prediction: InferSession.Pred) {
    let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text != spokenText else { return }

    spokenText = text
    transcript.append(prediction)
    logSpeech(.speechRequested, prediction: prediction)
    speech.speak(text)
  }

  private func finishPendingSpeech(text: String, prediction: InferSession.Pred) {
    guard status != .idle else {
      logSpeech(.pendingBlocked, prediction: prediction, reason: "stream_idle")
      return
    }
    guard pendingSpeechText == text else {
      logSpeech(.pendingBlocked, prediction: prediction, reason: "pending_changed")
      return
    }
    guard current?.text == prediction.text else {
      logSpeech(.pendingBlocked, prediction: prediction, reason: "prediction_changed")
      resetPendingSpeech()
      return
    }

    logSpeech(.pendingFired, prediction: prediction)
    resetPendingSpeech()
    speak(prediction)
    if current?.text == prediction.text {
      current = nil
      logSpeech(.clear)
    }
    Task { [recognizer] in
      await recognizer.resetAfterSpokenPartial()
    }
  }

  private func cancelPendingSpeech(reason: String) {
    if pendingSpeechTask != nil || pendingSpeechText != nil {
      logSpeech(.pendingCanceled, text: pendingSpeechText, reason: reason)
    }
    resetPendingSpeech()
  }

  private func resetPendingSpeech() {
    pendingSpeechTask?.cancel()
    pendingSpeechTask = nil
    pendingSpeechText = nil
  }

  private func logSpeech(
    _ event: SpeechLogEvent,
    prediction: InferSession.Pred? = nil,
    text: String? = nil,
    reason: String? = nil
  ) {
    speechLog.append(
      SpeechLogEntry(
        timestamp: Date(),
        event: event,
        reason: reason,
        source: (activeSource ?? source).title,
        status: status.logTitle,
        text: text ?? prediction?.text.trimmingCharacters(in: .whitespacesAndNewlines),
        confidence: prediction?.confidence,
        processingTimeMs: prediction?.processingTimeMs,
        currentText: current?.text,
        pendingText: pendingSpeechText,
        spokenText: spokenText
      )
    )

    if speechLog.count > Self.maxSpeechLogEntries {
      speechLog.removeFirst(speechLog.count - Self.maxSpeechLogEntries)
    }
    speechLogCount = speechLog.count
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
    await phoneCamera.stop()

    self.stream = nil
    self.session = nil
    activeSource = nil
    await frameGate.reset()
    streamStarted = false
    status = .idle
    latestFrame = nil
    overlayFrame = .empty
    statusText = "Starting"
    current = nil
    isSpeaking = false
    emptyReads = 0
    cancelPendingSpeech(reason: "teardown")
    spokenText = nil
    transcript.removeAll(keepingCapacity: true)
    speech.reset()
    isTearingDown = false
  }
}

extension StreamModel.Status {
  fileprivate var logTitle: String {
    switch self {
    case .idle: "idle"
    case .connecting: "connecting"
    case .streaming: "streaming"
    }
  }
}
