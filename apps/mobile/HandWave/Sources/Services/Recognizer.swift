import CoreMedia
import Foundation

actor Recognizer {
  private static let retryDelay: Duration = .seconds(5)

  private let detector: LandmarkDetector
  private let inference: InferSession
  private var isPrepared = false
  private var isInferenceReady = false
  private var retryAt = ContinuousClock.now
  private var backendFailure: InferenceFailure?
  private var preparationTask: Task<Void, Error>?
  private var warmupTask: Task<Void, Never>?
  private var generation = 0

  init(
    detector: LandmarkDetector = LandmarkDetector(),
    inference: InferSession = InferSession()
  ) {
    self.detector = detector
    self.inference = inference
  }

  func start(onEvent: @escaping InferSession.EventHandler) async throws {
    generation &+= 1
    let startGeneration = generation
    await inference.setEventHandler(onEvent)
    try await prepare()
    guard generation == startGeneration else { throw CancellationError() }
    warmupTask = Task { [weak self] in
      await self?.warmInference(generation: startGeneration)
    }
  }

  func prepare() async throws {
    guard !isPrepared else { return }
    if let preparationTask {
      return try await preparationTask.value
    }

    let task = Task { try await detector.prepare() }
    preparationTask = task
    do {
      try await task.value
      isPrepared = true
      preparationTask = nil
    } catch {
      preparationTask = nil
      throw error
    }
  }

  func process(_ frame: FramePipeline.Frame) async throws -> RecognitionOutput {
    let cameraFrame: CameraFrame
    let poseMode: LandmarkDetector.PoseMode
    switch frame {
    case .glasses(let frame):
      cameraFrame = CameraFrame(sampleBuffer: frame.sampleBuffer)
      poseMode = .fallback
    case .phone(let frame):
      cameraFrame = frame
      poseMode = .required
    }

    let timestamp = Self.timestampMs(for: cameraFrame.sampleBuffer)
    let detection = try await detector.detect(
      sampleBuffer: cameraFrame.sampleBuffer,
      timestampMs: timestamp,
      poseMode: poseMode
    )
    try Task.checkCancellation()
    let result = await ingest(detection.inferenceFrame, at: timestamp)
    return RecognitionOutput(
      event: result.event,
      overlay: detection.overlayFrame,
      hasLandmarks: detection.inferenceFrame != nil,
      backendFailure: result.failure
    )
  }

  func resetAfterSpokenPartial() async {
    await inference.resetAfterSpokenPartial()
  }

  func stop() async {
    generation &+= 1
    warmupTask?.cancel()
    warmupTask = nil
    isInferenceReady = false
    retryAt = .now
    backendFailure = nil
    await detector.resetSelection()
    await inference.stop()
  }

  private func ingest(
    _ frame: LandmarkFrame?,
    at timestampMs: Int
  ) async -> (event: RecognitionEvent?, failure: InferenceFailure?) {
    guard isInferenceReady || ContinuousClock.now >= retryAt else {
      return (nil, backendFailure)
    }

    if !isInferenceReady {
      do {
        try await inference.start()
        isInferenceReady = true
        backendFailure = nil
      } catch {
        record(error)
        return (nil, backendFailure)
      }
    }

    do {
      let event = try await inference.ingest(frame, at: timestampMs)
      backendFailure = nil
      return (event, nil)
    } catch {
      record(error)
      return (nil, backendFailure)
    }
  }

  private func warmInference(generation expectedGeneration: Int) async {
    guard generation == expectedGeneration, !isInferenceReady, !Task.isCancelled else { return }
    do {
      try await inference.start()
      guard generation == expectedGeneration, !Task.isCancelled else { return }
      isInferenceReady = true
      backendFailure = nil
    } catch {
      guard generation == expectedGeneration, !Task.isCancelled else { return }
      record(error)
    }
  }

  private func record(_ failure: InferenceFailure) {
    guard failure != .cancelled else { return }
    isInferenceReady = false
    backendFailure = failure
    retryAt = .now.advanced(by: Self.retryDelay)
    AppLog.inference.error(
      "Inference unavailable: \(failure.localizedDescription, privacy: .private)")
  }

  private static func timestampMs(for sampleBuffer: CMSampleBuffer) -> Int {
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard time.isValid, time.seconds.isFinite else {
      return Int(Date().timeIntervalSince1970 * 1_000)
    }
    return Int((time.seconds * 1_000).rounded())
  }
}
