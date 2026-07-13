import CoreMedia
import Foundation

struct Prediction: Equatable, Sendable {
  let text: String
  let confidence: Double
  let processingTimeMs: Double
}

enum RecognitionEvent: Equatable, Sendable {
  case clear
  case partial(Prediction)
  case finalized(Prediction)
}

struct RecognitionOutput: Sendable {
  let event: RecognitionEvent?
  let overlay: HandLandmarksFrame
  let hasLandmarks: Bool
  let backendFailure: InferenceFailure?
}

struct CameraFrame: @unchecked Sendable {
  let sampleBuffer: CMSampleBuffer
}
