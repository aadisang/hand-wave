import Foundation

struct LandmarkPoint: Codable, Equatable, Sendable {
  let x: Double
  let y: Double
  let z: Double?
}

struct LandmarkFrame: Codable, Equatable, Sendable {
  let landmarks: [LandmarkPoint]
  let timestampMs: Int

  init(landmarks: [LandmarkPoint], timestampMs: Int) {
    self.landmarks = landmarks
    self.timestampMs = timestampMs
  }

  init(from decoder: Decoder) throws {
    var container = try decoder.unkeyedContainer()
    var landmarks: [LandmarkPoint] = []
    while !container.isAtEnd {
      let x = try container.decode(Double.self)
      let y = try container.decode(Double.self)
      let z = try container.decode(Double.self)
      landmarks.append(LandmarkPoint(x: x, y: y, z: z))
    }
    self.init(landmarks: landmarks, timestampMs: 0)
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.unkeyedContainer()
    for landmark in landmarks {
      try container.encode(landmark.x)
      try container.encode(landmark.y)
      try container.encode(landmark.z ?? 0)
    }
  }

  var inferenceFeatures: InferenceLandmarkFrame {
    landmarks.flatMap { [$0.x, $0.y, $0.z ?? 0] }
  }
}

struct HandLandmarksFrame: Equatable, Sendable {
  let rightHandLandmarks: [[LandmarkPoint]]
  let leftHandLandmarks: [[LandmarkPoint]]
  let poseLandmarks: [[LandmarkPoint]]

  init(
    rightHandLandmarks: [[LandmarkPoint]],
    leftHandLandmarks: [[LandmarkPoint]],
    poseLandmarks: [[LandmarkPoint]] = []
  ) {
    self.rightHandLandmarks = rightHandLandmarks
    self.leftHandLandmarks = leftHandLandmarks
    self.poseLandmarks = poseLandmarks
  }

  static let empty = Self(
    rightHandLandmarks: [],
    leftHandLandmarks: []
  )

  var isEmpty: Bool {
    rightHandLandmarks.isEmpty && leftHandLandmarks.isEmpty && poseLandmarks.isEmpty
  }
}

struct DetectResult: Equatable, Sendable {
  let inferenceFrame: LandmarkFrame?
  let overlayFrame: HandLandmarksFrame
}

typealias Span = InferenceSpan
