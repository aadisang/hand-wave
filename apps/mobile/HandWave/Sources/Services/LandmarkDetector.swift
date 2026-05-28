import CoreMedia
import Foundation
import MediaPipeTasksVision
import UIKit

actor LandmarkDetector {
  private enum HandSide {
    case left
    case right
  }

  private struct ActiveHandSelector {
    private var active: HandSide?
    private var previousLeft: [LandmarkPoint]?
    private var previousRight: [LandmarkPoint]?

    mutating func select(_ frame: HandLandmarksFrame) -> HandSide? {
      let right = frame.rightHandLandmarks.first
      let left = frame.leftHandLandmarks.first
      guard right != nil || left != nil else {
        reset()
        return nil
      }

      let selected = selectActiveHand(right: right, left: left)
      active = selected
      previousRight = right
      previousLeft = left
      return selected
    }

    mutating func reset() {
      active = nil
      previousLeft = nil
      previousRight = nil
    }

    private func selectActiveHand(
      right: [LandmarkPoint]?,
      left: [LandmarkPoint]?
    ) -> HandSide? {
      guard let right else { return left == nil ? nil : .left }
      guard let left else { return .right }

      let rightMotion = Self.motion(previous: previousRight, current: right)
      let leftMotion = Self.motion(previous: previousLeft, current: left)

      if let active {
        let other: HandSide = active == .right ? .left : .right
        let activeMotion = active == .right ? rightMotion : leftMotion
        let otherMotion = other == .right ? rightMotion : leftMotion
        if otherMotion > 0.015, otherMotion > activeMotion + 0.012 {
          return other
        }
        return active
      }

      if abs(leftMotion - rightMotion) > 0.012 {
        return leftMotion > rightMotion ? .left : .right
      }

      return Self.handSpan(left) > Self.handSpan(right) ? .left : .right
    }

    private static func motion(
      previous: [LandmarkPoint]?,
      current: [LandmarkPoint]
    ) -> Double {
      guard let previous, previous.count == current.count else { return 0 }
      var total = 0.0
      for index in current.indices {
        let a = previous[index]
        let b = current[index]
        total += sqrt(
          pow(b.x - a.x, 2) + pow(b.y - a.y, 2) + pow((b.z ?? 0) - (a.z ?? 0), 2)
        )
      }
      return total / Double(current.count)
    }

    private static func handSpan(_ points: [LandmarkPoint]) -> Double {
      var minX = Double.infinity
      var maxX = -Double.infinity
      var minY = Double.infinity
      var maxY = -Double.infinity
      for point in points {
        minX = min(minX, point.x)
        maxX = max(maxX, point.x)
        minY = min(minY, point.y)
        maxY = max(maxY, point.y)
      }
      return sqrt(pow(maxX - minX, 2) + pow(maxY - minY, 2))
    }
  }

  enum DetectorError: Error, LocalizedError {
    case modelUnavailable(String)
    case invalidImage

    var errorDescription: String? {
      switch self {
      case .modelUnavailable(let name):
        "Could not load the \(name) MediaPipe model."
      case .invalidImage:
        "Could not convert the wearable frame for MediaPipe."
      }
    }
  }

  private var lastTimestampMs = 0
  private var handLandmarker: HandLandmarker?
  private var poseLandmarker: PoseLandmarker?
  private var activeHandSelector = ActiveHandSelector()
  private static let requiredPoseIndices = [0, 11, 12]
  private static let minFrameCoordinate = -0.15
  private static let maxFrameCoordinate = 1.15

  func prepare() async throws {
    if handLandmarker != nil, poseLandmarker != nil { return }

    let handPath = try await modelPath(
      resource: "hand_landmarker",
      fileName: "hand_landmarker.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
      )!
    )
    let posePath = try await modelPath(
      resource: "pose_landmarker_lite",
      fileName: "pose_landmarker_lite.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
      )!
    )

    let handOptions = HandLandmarkerOptions()
    handOptions.baseOptions.modelAssetPath = handPath
    handOptions.runningMode = .video
    handOptions.numHands = 2
    handOptions.minHandDetectionConfidence = 0.5
    handOptions.minHandPresenceConfidence = 0.3
    handOptions.minTrackingConfidence = 0.3
    handLandmarker = try HandLandmarker(options: handOptions)

    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = posePath
    poseOptions.runningMode = .video
    poseOptions.numPoses = 1
    poseOptions.minPoseDetectionConfidence = 0.3
    poseOptions.minPosePresenceConfidence = 0.3
    poseOptions.minTrackingConfidence = 0.3
    poseLandmarker = try PoseLandmarker(options: poseOptions)
  }

  func detect(
    sampleBuffer: CMSampleBuffer,
    timestampMs rawTimestampMs: Int
  ) async throws -> DetectResult {
    try await prepare()
    guard let handLandmarker, let poseLandmarker else {
      throw DetectorError.modelUnavailable("landmarker")
    }
    guard let image = try? MPImage(sampleBuffer: sampleBuffer) else {
      throw DetectorError.invalidImage
    }

    let timestampMs = max(rawTimestampMs, lastTimestampMs + 1)
    lastTimestampMs = timestampMs

    let handResult = try handLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )
    let poseResult = try poseLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )

    let frame = HandLandmarksFrame(
      rightHandLandmarks: rightHands(from: handResult),
      leftHandLandmarks: leftHands(from: handResult),
      poseLandmarks: poseResult.landmarks.map { $0.map(LandmarkPoint.init) }
    )
    let selectedHand = activeHandSelector.select(frame)
    return DetectResult(
      inferenceFrame: Self.toInferenceFrame(
        frame,
        selectedHand: selectedHand,
        timestampMs: timestampMs
      ),
      overlayFrame: frame
    )
  }

  func resetSelection() {
    activeHandSelector.reset()
  }

  private static func toInferenceFrame(
    _ frame: HandLandmarksFrame,
    selectedHand: HandSide?,
    timestampMs: Int
  ) -> LandmarkFrame? {
    let right = frame.rightHandLandmarks.first
    let left = frame.leftHandLandmarks.first
    guard let pose = frame.poseLandmarks.first, right != nil || left != nil else {
      return nil
    }

    let side =
      selectedHand.flatMap { landmarks(in: frame, side: $0) == nil ? nil : $0 }
      ?? (right != nil ? .right : .left)
    guard let sourceHand = landmarks(in: frame, side: side) else { return nil }

    let useLeft = side == .left
    let modelHand = useLeft ? mirror(sourceHand) : sourceHand
    let alignedPose = useLeft ? mirror(pose) : pose
    guard modelHand.count == 21, alignedPose.count == 33 else { return nil }
    guard modelHand.allSatisfy(validPoint), validPose(alignedPose) else { return nil }

    return LandmarkFrame(
      landmarks: modelHand + alignedPose,
      timestampMs: timestampMs
    )
  }

  private static func landmarks(
    in frame: HandLandmarksFrame,
    side: HandSide
  ) -> [LandmarkPoint]? {
    switch side {
    case .left:
      frame.leftHandLandmarks.first
    case .right:
      frame.rightHandLandmarks.first
    }
  }

  private static func mirror(_ points: [LandmarkPoint]) -> [LandmarkPoint] {
    points.map { LandmarkPoint(x: 1 - $0.x, y: $0.y, z: $0.z) }
  }

  private static func validPose(_ points: [LandmarkPoint]) -> Bool {
    requiredPoseIndices.allSatisfy { index in
      guard let point = points[safe: index] else { return false }
      return validPoint(point) && inFrame(point)
    }
  }

  private static func validPoint(_ point: LandmarkPoint) -> Bool {
    point.x.isFinite && point.y.isFinite && (point.z?.isFinite ?? true)
  }

  private static func inFrame(_ point: LandmarkPoint) -> Bool {
    (minFrameCoordinate...maxFrameCoordinate).contains(point.x)
      && (minFrameCoordinate...maxFrameCoordinate).contains(point.y)
  }

  private func rightHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Right")
  }

  private func leftHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Left")
  }

  private func hands(
    from result: HandLandmarkerResult,
    matching handedness: String
  ) -> [[LandmarkPoint]] {
    result.landmarks.enumerated().compactMap { index, landmarks in
      let category = result.handedness[safe: index]?.first?.categoryName
      guard category == handedness || (handedness == "Right" && category == nil) else {
        return nil
      }
      return landmarks.map(LandmarkPoint.init)
    }
  }

  private func modelPath(
    resource: String,
    fileName: String,
    remoteURL: URL
  ) async throws -> String {
    if let bundled = Bundle.main.path(forResource: resource, ofType: "task") {
      return bundled
    }

    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appending(path: "MediaPipeModels", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )

    let localURL = directory.appending(path: fileName)
    if FileManager.default.fileExists(atPath: localURL.path) {
      return localURL.path
    }

    let (downloadURL, response) = try await URLSession.shared.download(from: remoteURL)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw DetectorError.modelUnavailable(fileName)
    }
    try FileManager.default.moveItem(at: downloadURL, to: localURL)
    return localURL.path
  }

}

extension LandmarkPoint {
  fileprivate init(_ landmark: NormalizedLandmark) {
    self.init(
      x: Double(landmark.x),
      y: Double(landmark.y),
      z: Double(landmark.z)
    )
  }
}

extension Collection {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
