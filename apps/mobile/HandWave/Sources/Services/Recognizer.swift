import CoreMedia
import Foundation
import MWDATCamera

actor Recognizer {
  struct Output: Sendable {
    let event: InferSession.Event?
    let overlayFrame: HandLandmarksFrame
    let hasFrame: Bool
    let error: String?
  }

  private let detector: LandmarkDetector
  private let inference: InferSession
  private var detStarted = false
  private var inferStarted = false
  private var retryAt = ContinuousClock.now
  private var backendError: String?

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
  }

  func stop() async {
    detStarted = false
    inferStarted = false
    retryAt = .now
    backendError = nil
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
      error: infer.error
    )
  }

  private func ingest(
    _ frame: LandmarkFrame?
  ) async -> (event: InferSession.Event?, error: String?) {
    guard inferStarted || ContinuousClock.now >= retryAt else {
      return (nil, backendError)
    }

    if !inferStarted {
      do {
        try await inference.start()
        inferStarted = true
        backendError = nil
      } catch {
        backendError = error.localizedDescription
        retryAt = .now.advanced(by: .seconds(5))
        return (nil, backendError)
      }
    }

    do {
      let event = try await inference.ingest(frame)
      backendError = nil
      return (event, nil)
    } catch {
      inferStarted = false
      backendError = error.localizedDescription
      retryAt = .now.advanced(by: .seconds(5))
      return (nil, backendError)
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
