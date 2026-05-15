import CoreMedia
import Foundation
import MWDATCamera

actor RecognitionPipeline {
  struct Output: Sendable {
    let event: InferenceSessionController.Event?
    let overlayLandmarks: [LandmarkPoint]
    let hasInferenceFrame: Bool
    let inferenceError: String?
  }

  private let detector: MediaPipeLandmarkDetector
  private let inference: InferenceSessionController
  private var detectorStarted = false
  private var inferenceStarted = false
  private var nextInferenceRetry = ContinuousClock.now

  init(
    detector: MediaPipeLandmarkDetector = MediaPipeLandmarkDetector(),
    inference: InferenceSessionController = InferenceSessionController()
  ) {
    self.detector = detector
    self.inference = inference
  }

  func start() async throws {
    if detectorStarted { return }
    try await detector.prepare()
    detectorStarted = true
  }

  func stop() async {
    detectorStarted = false
    inferenceStarted = false
    nextInferenceRetry = .now
    await inference.stop()
  }

  func process(_ frame: VideoFrame) async throws -> Output {
    try await start()
    let sampleBuffer = frame.sampleBuffer
    let timestampMs = Self.timestampMilliseconds(for: sampleBuffer)
    let detection = try await detector.detect(
      sampleBuffer: sampleBuffer,
      timestampMs: timestampMs
    )
    let inferenceResult = await ingestForInference(detection.inferenceFrame)
    return Output(
      event: inferenceResult.event,
      overlayLandmarks: detection.overlayLandmarks,
      hasInferenceFrame: detection.inferenceFrame != nil,
      inferenceError: inferenceResult.error
    )
  }

  private func ingestForInference(
    _ frame: LandmarkFrame?
  ) async -> (event: InferenceSessionController.Event?, error: String?) {
    guard let frame else { return (nil, nil) }
    guard inferenceStarted || ContinuousClock.now >= nextInferenceRetry else {
      return (nil, nil)
    }

    if !inferenceStarted {
      do {
        try await inference.start()
        inferenceStarted = true
      } catch {
        nextInferenceRetry = .now.advanced(by: .seconds(5))
        return (nil, error.localizedDescription)
      }
    }

    do {
      return (try await inference.ingest(frame), nil)
    } catch {
      inferenceStarted = false
      nextInferenceRetry = .now.advanced(by: .seconds(5))
      return (nil, error.localizedDescription)
    }
  }

  private static func timestampMilliseconds(for sampleBuffer: CMSampleBuffer) -> Int {
    let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    if presentationTime.isValid && presentationTime.seconds.isFinite {
      return Int((presentationTime.seconds * 1_000).rounded())
    }
    return Int((Date().timeIntervalSince1970 * 1_000).rounded())
  }
}
