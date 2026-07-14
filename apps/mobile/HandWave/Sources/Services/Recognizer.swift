import CoreMedia
import Foundation

actor Recognizer {
  private static let retryDelay: Duration = .seconds(5)

  private let detector: LandmarkDetector
  private let inference: InferSession
  private var isInferenceReady = false
  private var backendFailure: InferenceFailure?
  private var warmupTask: Task<Void, Never>?
  private var generation = 0

  init(
    detector: LandmarkDetector = LandmarkDetector(),
    inference: InferSession = InferSession()
  ) {
    self.detector = detector
    self.inference = inference
  }

  func start(
    poseMode: LandmarkDetector.PoseMode,
    onEvent: @escaping InferSession.EventHandler
  ) async throws {
    generation &+= 1
    let startGeneration = generation
    await inference.setEventHandler(onEvent)
    try await detector.prepare(poseMode: poseMode)
    guard generation == startGeneration else { throw CancellationError() }
    startWarmup(generation: startGeneration)
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
    let result: (event: RecognitionEvent?, failure: InferenceFailure?)
    if isInferenceReady {
      result = await ingest(detection.inferenceFrame, at: timestamp)
    } else {
      startWarmup(generation: generation)
      result = (nil, backendFailure)
    }
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
    backendFailure = nil
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
        isInferenceReady = true
        backendFailure = nil
        AppLog.inference.notice("Inference backend ready")
      } catch {
        guard generation == expectedGeneration, !Task.isCancelled else { break }
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

  private static func timestampMs(for sampleBuffer: CMSampleBuffer) -> Int {
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard time.isValid, time.seconds.isFinite else {
      return Int(Date().timeIntervalSince1970 * 1_000)
    }
    return Int((time.seconds * 1_000).rounded())
  }
}
