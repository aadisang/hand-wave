import Foundation

struct LandmarkPoint: Codable, Equatable, Sendable {
  let x: Double
  let y: Double
  let z: Double?
}

struct LandmarkFrame: Codable, Equatable, Sendable {
  let landmarks: [LandmarkPoint]
  let timestampMs: Int

  enum CodingKeys: String, CodingKey {
    case landmarks
    case timestampMs = "timestamp_ms"
  }
}

struct HandLandmarksFrame: Equatable, Sendable {
  let rightHandLandmarks: [[LandmarkPoint]]
  let leftHandLandmarks: [[LandmarkPoint]]
  let poseLandmarks: [[LandmarkPoint]]
}

struct LandmarkDetectionResult: Equatable, Sendable {
  let inferenceFrame: LandmarkFrame?
  let overlayLandmarks: [LandmarkPoint]
}

struct Prediction: Codable, Equatable, Sendable {
  let label: String
  let confidence: Double
}

struct StreamPredictionResponse: Codable, Equatable, Sendable {
  let sessionId: String
  let bufferedFrames: Int
  let prediction: Prediction
  let alternatives: [Prediction]
  let partialText: String
  let stableText: String

  enum CodingKeys: String, CodingKey {
    case sessionId = "session_id"
    case bufferedFrames = "buffered_frames"
    case prediction
    case alternatives
    case partialText = "partial_text"
    case stableText = "stable_text"
  }
}

struct InferenceResetResponse: Codable, Equatable, Sendable {
  let sessionId: String
  let bufferedFrames: Int
  let partialText: String
  let stableText: String

  enum CodingKeys: String, CodingKey {
    case sessionId = "session_id"
    case bufferedFrames = "buffered_frames"
    case partialText = "partial_text"
    case stableText = "stable_text"
  }
}
