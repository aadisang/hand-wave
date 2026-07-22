import Foundation

actor Recognizer {
  private static let retryDelay: Duration = .seconds(5)
  private static let bufferedFrameLimit = 256

  private struct BufferedFrame: Sendable {
    let frame: LandmarkFrame?
    let timestampMs: Int
  }

  private let detector: LandmarkDetector
  private let inference: InferSession
  private var isInferenceReady = false
  private var backendFailure: InferenceFailure?
  private var warmupTask: Task<Void, Never>?
  private var eventHandler: InferSession.EventHandler?
  private var bufferedFrames: [BufferedFrame] = []
  private var isReplaying = false
  private var generation = 0

  init(
    detector: LandmarkDetector = LandmarkDetector(),
    inference: InferSession = InferSession()
  ) {
    self.detector = detector
    self.inference = inference
  }

  func prepare() async throws {
    try await detector.prepare()
  }

  func start(
    onEvent: @escaping InferSession.EventHandler
  ) async throws {
    generation &+= 1
    let startGeneration = generation
    await inference.setEventHandler(onEvent)
    eventHandler = onEvent
    try await prepare()
    guard generation == startGeneration else { throw CancellationError() }
    startWarmup(generation: startGeneration)
  }

  func process(_ frame: FramePipeline.Frame) async throws -> RecognitionOutput {
    let cameraFrame: CameraFrame
    switch frame {
    case .glasses(let frame):
      cameraFrame = CameraFrame(sampleBuffer: frame.sampleBuffer, isMirrored: false)
    case .phone(let frame):
      cameraFrame = frame
    }

    let detection = try await detector.detect(
      sampleBuffer: cameraFrame.sampleBuffer,
      isMirrored: cameraFrame.isMirrored
    )
    try Task.checkCancellation()
    let result: (event: RecognitionEvent?, failure: InferenceFailure?)
    if isInferenceReady, !isReplaying {
      result = await ingest(detection.inferenceFrame, at: detection.timestampMs)
    } else {
      buffer(detection.inferenceFrame, at: detection.timestampMs)
      startWarmup(generation: generation)
      result = (nil, backendFailure)
    }
    return RecognitionOutput(
      event: result.event,
      overlay: detection.overlayFrame,
      hasLandmarks: detection.inferenceFrame != nil,
      needsPose: detection.inferenceFrame == nil
        && (!detection.overlayFrame.landmarks.rightHandLandmarks.isEmpty
          || !detection.overlayFrame.landmarks.leftHandLandmarks.isEmpty),
      backendFailure: result.failure
    )
  }

  func stop() async {
    generation &+= 1
    warmupTask?.cancel()
    warmupTask = nil
    isInferenceReady = false
    isReplaying = false
    backendFailure = nil
    eventHandler = nil
    bufferedFrames.removeAll(keepingCapacity: true)
    await detector.resetSelection()
    await inference.stop()
  }

  private func ingest(
    _ frame: LandmarkFrame?,
    at timestampMs: Int
  ) async -> (event: RecognitionEvent?, failure: InferenceFailure?) {
    do {
      let event = try await inference.ingest(frame, at: timestampMs)
      backendFailure = nil
      return (event, nil)
    } catch {
      record(error)
      startWarmup(generation: generation)
      return (nil, backendFailure)
    }
  }

  private func startWarmup(generation expectedGeneration: Int) {
    guard !isInferenceReady, warmupTask == nil else { return }
    warmupTask = Task { [weak self] in
      await self?.warmInference(generation: expectedGeneration)
    }
  }

  private func warmInference(generation expectedGeneration: Int) async {
    while generation == expectedGeneration, !isInferenceReady, !Task.isCancelled {
      do {
        try await inference.start()
        guard generation == expectedGeneration, !Task.isCancelled else { break }
        isReplaying = true
        try await replayBufferedFrames(generation: expectedGeneration)
        guard generation == expectedGeneration, !Task.isCancelled else { break }
        isReplaying = false
        isInferenceReady = true
        backendFailure = nil
        AppLog.inference.notice("Inference backend ready")
      } catch {
        guard generation == expectedGeneration, !Task.isCancelled else { break }
        isReplaying = false
        record(error)
        try? await Task.sleep(for: Self.retryDelay)
      }
    }
    guard generation == expectedGeneration else { return }
    warmupTask = nil
  }

  private func record(_ failure: InferenceFailure) {
    guard failure != .cancelled else { return }
    isInferenceReady = false
    backendFailure = failure
    AppLog.inference.error(
      "Inference unavailable: \(failure.localizedDescription, privacy: .private)")
  }

  private func buffer(_ frame: LandmarkFrame?, at timestampMs: Int) {
    bufferedFrames.append(BufferedFrame(frame: frame, timestampMs: timestampMs))
    if bufferedFrames.count > Self.bufferedFrameLimit {
      bufferedFrames.removeFirst(bufferedFrames.count - Self.bufferedFrameLimit)
    }
  }

  private func replayBufferedFrames(
    generation expectedGeneration: Int
  ) async throws(InferenceFailure) {
    while generation == expectedGeneration, !Task.isCancelled, !bufferedFrames.isEmpty {
      let buffered = bufferedFrames.removeFirst()
      do {
        if let event = try await inference.ingest(
          buffered.frame,
          at: buffered.timestampMs
        ) {
          await eventHandler?(event)
        }
      } catch let failure {
        bufferedFrames.insert(buffered, at: 0)
        throw failure
      }
    }
  }
}
