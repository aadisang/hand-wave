import CoreMedia
import Foundation

struct Prediction: Equatable, Sendable {
  let text: String
  let confidence: Double
  let processingTimeMs: Double

  var isMeaningful: Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).count > 1
  }
}

enum RecognitionEvent: Equatable, Sendable {
  case clear
  case partial(Prediction)
  case finalized(Prediction)

  var finalizedSpeechText: String? {
    guard case .finalized(let prediction) = self, prediction.isMeaningful else { return nil }
    let text = prediction.text.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }
}

struct RecognitionOutput: Sendable {
  let event: RecognitionEvent?
  let overlay: HandLandmarksFrame
  let hasLandmarks: Bool
  let needsPose: Bool
  let backendFailure: InferenceFailure?
}

struct CameraFrame: @unchecked Sendable {
  let sampleBuffer: CMSampleBuffer
  let isMirrored: Bool
}
