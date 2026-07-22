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

  /// Flips landmark coordinates across the vertical axis. Hand side labels are
  /// anatomical and stay put.
  func mirroredHorizontally() -> Self {
    Self(
      rightHandLandmarks: rightHandLandmarks.map(Self.mirrorPoints),
      leftHandLandmarks: leftHandLandmarks.map(Self.mirrorPoints),
      poseLandmarks: poseLandmarks.map(Self.mirrorPoints)
    )
  }

  private static func mirrorPoints(_ points: [LandmarkPoint]) -> [LandmarkPoint] {
    points.map { LandmarkPoint(x: 1 - $0.x, y: $0.y, z: $0.z) }
  }
}

/// Landmarks paired with the source image size they were detected in, which the
/// preview overlay needs to project points into the displayed viewport.
struct LandmarkOverlayFrame: Equatable, Sendable {
  let landmarks: HandLandmarksFrame
  let imageSize: LandmarkImageSize?

  static let empty = Self(landmarks: .empty, imageSize: nil)
}

struct DetectResult: Equatable, Sendable {
  let inferenceFrame: LandmarkFrame?
  let overlayFrame: LandmarkOverlayFrame
  let timestampMs: Int
}
