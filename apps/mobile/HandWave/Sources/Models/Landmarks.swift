import Foundation

struct LandmarkPoint: Equatable, Sendable {
  let x: Double
  let y: Double
  let z: Double?
}

struct LandmarkImageSize: Equatable, Sendable {
  let width: Double
  let height: Double
}

struct LandmarkFrame: Equatable, Sendable {
  let landmarks: [LandmarkPoint]
  let timestampMs: Int

  init(landmarks: [LandmarkPoint], timestampMs: Int) {
    self.landmarks = landmarks
    self.timestampMs = timestampMs
  }

  var inferenceFeatures: InferenceLandmarkFrameItem {
    landmarks.flatMap { [$0.x, $0.y, $0.z ?? 0] }
  }
}

struct HandLandmarksFrame: Equatable, Sendable {
  let rightHandLandmarks: [[LandmarkPoint]]
  let leftHandLandmarks: [[LandmarkPoint]]
  let poseLandmarks: [[LandmarkPoint]]
  let imageSize: LandmarkImageSize?

  init(
    rightHandLandmarks: [[LandmarkPoint]],
    leftHandLandmarks: [[LandmarkPoint]],
    poseLandmarks: [[LandmarkPoint]] = [],
    imageSize: LandmarkImageSize? = nil
  ) {
    self.rightHandLandmarks = rightHandLandmarks
    self.leftHandLandmarks = leftHandLandmarks
    self.poseLandmarks = poseLandmarks
    self.imageSize = imageSize
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
  let timestampMs: Int
}
