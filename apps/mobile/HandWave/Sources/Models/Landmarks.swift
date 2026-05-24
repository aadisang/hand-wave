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

struct DetectResult: Equatable, Sendable {
  let inferenceFrame: LandmarkFrame?
  let overlayLandmarks: [LandmarkPoint]
}

struct Prediction: Codable, Equatable, Sendable {
  let label: String
  let confidence: Double
  let logitScore: Double?
  let lmScore: Double?
  let rawLabel: String?

  enum CodingKeys: String, CodingKey {
    case label
    case confidence
    case logitScore = "logit_score"
    case lmScore = "lm_score"
    case rawLabel = "raw_label"
  }
}

struct StreamPred: Codable, Equatable, Sendable {
  let prediction: Prediction
  let alternatives: [Prediction]
  let greedyText: String
  let partialText: String
  let stableText: String

  enum CodingKeys: String, CodingKey {
    case prediction
    case alternatives
    case greedyText = "greedy_text"
    case partialText = "partial_text"
    case stableText = "stable_text"
  }
}
