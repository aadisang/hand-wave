import CoreMedia
import Foundation
import MWDATCamera

actor Recognizer {
  struct Output: Sendable {
    let event: InferSession.Event?
    let overlayFrame: HandLandmarksFrame
    let hasFrame: Bool
    let failure: InferenceFailure?
  }

  private let detector: LandmarkDetector
  private let inference: InferSession
  private var detStarted = false
  private var inferStarted = false
  private var retryAt = ContinuousClock.now
  private var backendFailure: InferenceFailure?

  init(
    detector: LandmarkDetector = LandmarkDetector(),
    inference: InferSession = InferSession()
  ) {
    self.detector = detector
    self.inference = inference
  }

  func start() async throws {
    if detStarted { return }
    try await detector.prepare()
    detStarted = true
    Task { await warmInference() }
  }

  func stop() async {
    detStarted = false
    inferStarted = false
    retryAt = .now
    backendFailure = nil
    await detector.resetSelection()
    await inference.stop()
  }

  func process(_ frame: VideoFrame) async throws -> Output {
    try await start()
    let sampleBuffer = frame.sampleBuffer
    let timestampMs = Self.timestampMs(for: sampleBuffer)
    let detection = try await detector.detect(
      sampleBuffer: sampleBuffer,
      timestampMs: timestampMs
    )
    let infer = await ingest(detection.inferenceFrame)
    return Output(
      event: infer.event,
      overlayFrame: detection.overlayFrame,
      hasFrame: detection.inferenceFrame != nil,
      failure: infer.failure
    )
  }

  private func ingest(
    _ frame: LandmarkFrame?
  ) async -> (event: InferSession.Event?, failure: InferenceFailure?) {
    guard inferStarted || ContinuousClock.now >= retryAt else {
      return (nil, backendFailure)
    }

    if !inferStarted {
      do {
        try await inference.start()
        inferStarted = true
        backendFailure = nil
      } catch {
        backendFailure = error
        retryAt = .now.advanced(by: .seconds(5))
        return (nil, backendFailure)
      }
    }

    do {
      let event = try await inference.ingest(frame)
      backendFailure = nil
      return (event, nil)
    } catch {
      inferStarted = false
      backendFailure = error
      retryAt = .now.advanced(by: .seconds(5))
      return (nil, backendFailure)
    }
  }

  private func warmInference() async {
    guard !inferStarted else { return }
    do {
      try await inference.start()
      inferStarted = true
      backendFailure = nil
    } catch {
      backendFailure = error
      retryAt = .now.advanced(by: .seconds(5))
    }
  }

  private static func timestampMs(for sampleBuffer: CMSampleBuffer) -> Int {
    let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    if presentationTime.isValid && presentationTime.seconds.isFinite {
      return Int((presentationTime.seconds * 1_000).rounded())
    }
    return Int((Date().timeIntervalSince1970 * 1_000).rounded())
  }
}
