import CoreMedia
import Foundation
import MediaPipeTasksVision

actor LandmarkDetector {
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
  private var handPreparation: Task<Void, Error>?
  private var posePreparation: Task<Void, Error>?
  private var activeHandSelector = ActiveHandSelector()
  private var recentLandmarks = RecentLandmarks()
  private var lastSelectedHand: HandSide?
  private var recentPose: [LandmarkPoint]?
  private var recentPoseAt = 0
  private var lastPoseDetectionAt = 0
  private var lastInputMirrored: Bool?
  private let imageBufferConverter = PixelBufferConverter()
  private static let poseSampleMs = 1_000 / 12
  private static let poseReuseMs = 500

  func prepare() async throws {
    try await prepareHand()
    try await preparePose()
  }

  private func prepareHand() async throws {
    if handLandmarker != nil { return }
    if let handPreparation {
      try await handPreparation.value
      return
    }

    let task = Task { try await self.buildHandLandmarker() }
    handPreparation = task
    do {
      try await task.value
      handPreparation = nil
    } catch {
      handPreparation = nil
      throw error
    }
  }

  private func buildHandLandmarker() async throws {
    let handPath = try await MediaPipeModelStore.path(
      resource: "hand_landmarker",
      fileName: "hand_landmarker.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
      )!
    )

    let handOptions = HandLandmarkerOptions()
    handOptions.baseOptions.modelAssetPath = handPath
    handOptions.runningMode = .video
    handOptions.numHands = 2
    handOptions.minHandDetectionConfidence = 0.4
    handOptions.minHandPresenceConfidence = 0.2
    handOptions.minTrackingConfidence = 0.2
    handLandmarker = try HandLandmarker(options: handOptions)
  }

  private func preparePose() async throws {
    if poseLandmarker != nil { return }
    if let posePreparation {
      try await posePreparation.value
      return
    }

    let task = Task { try await self.buildPoseLandmarker() }
    posePreparation = task
    do {
      try await task.value
      posePreparation = nil
    } catch {
      posePreparation = nil
      throw error
    }
  }

  private func buildPoseLandmarker() async throws {
    let posePath = try await MediaPipeModelStore.path(
      resource: "pose_landmarker_lite",
      fileName: "pose_landmarker_lite.task",
      remoteURL: URL(
        string:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
      )!
    )

    let poseOptions = PoseLandmarkerOptions()
    poseOptions.baseOptions.modelAssetPath = posePath
    poseOptions.runningMode = .video
    poseOptions.numPoses = 1
    poseOptions.minPoseDetectionConfidence = 0.5
    poseOptions.minPosePresenceConfidence = 0.5
    poseOptions.minTrackingConfidence = 0.5
    poseLandmarker = try PoseLandmarker(options: poseOptions)
  }

  func detect(
    sampleBuffer: CMSampleBuffer,
    isMirrored: Bool
  ) async throws -> DetectResult {
    try await prepare()
    guard let handLandmarker else {
      throw DetectorError.modelUnavailable("landmarker")
    }
    let mediaPipeBuffer = try imageBufferConverter.bgraSampleBuffer(from: sampleBuffer)
    guard
      let imageBuffer = CMSampleBufferGetImageBuffer(mediaPipeBuffer),
      let image = try? MPImage(sampleBuffer: mediaPipeBuffer)
    else {
      throw DetectorError.invalidImage
    }
    let imageSize = LandmarkImageSize(
      width: Double(CVPixelBufferGetWidth(imageBuffer)),
      height: Double(CVPixelBufferGetHeight(imageBuffer))
    )

    // Camera and wearable presentation times use different timelines and can
    // restart after an app pause. MediaPipe video mode requires one strictly
    // increasing timeline for the full life of each landmarker instance.
    let uptimeMs = Int((ProcessInfo.processInfo.systemUptime * 1_000).rounded(.down))
    let timestampMs = max(uptimeMs, lastTimestampMs + 1)
    lastTimestampMs = timestampMs
    if lastInputMirrored != isMirrored {
      resetSelection()
      lastInputMirrored = isMirrored
    }

    let handResult = try handLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )
    let pose = try await detectPose(
      in: image,
      timestampMs: timestampMs
    )

    let rightHands = hands(from: handResult, side: .right, isMirrored: isMirrored)
    let leftHands = hands(from: handResult, side: .left, isMirrored: isMirrored)
    let overlayFrame = HandLandmarksFrame(
      rightHandLandmarks: rightHands,
      leftHandLandmarks: leftHands,
      poseLandmarks: pose.map { [$0] } ?? [],
      imageSize: imageSize
    )
    let modelPose = pose.map { Self.modelPoints($0, isMirrored: isMirrored) }
    let modelFrame = HandLandmarksFrame(
      rightHandLandmarks: rightHands.map { Self.modelPoints($0, isMirrored: isMirrored) },
      leftHandLandmarks: leftHands.map { Self.modelPoints($0, isMirrored: isMirrored) },
      poseLandmarks: modelPose.map { [$0] } ?? [],
      imageSize: imageSize
    )
    let selectedHand = activeHandSelector.select(modelFrame)
    if let selectedHand {
      lastSelectedHand = selectedHand
    }
    recentLandmarks.remember(modelFrame, timestampMs: timestampMs)
    return DetectResult(
      inferenceFrame: LandmarkSelection.toInferenceFrame(
        modelFrame,
        pose: modelPose,
        selectedHand: selectedHand ?? lastSelectedHand,
        timestampMs: timestampMs,
        recentLandmarks: recentLandmarks
      ),
      overlayFrame: overlayFrame,
      timestampMs: timestampMs
    )
  }

  func resetSelection() {
    activeHandSelector.reset()
    recentLandmarks.reset()
    lastSelectedHand = nil
    recentPose = nil
    recentPoseAt = 0
    lastPoseDetectionAt = 0
  }

  private func detectPose(
    in image: MPImage,
    timestampMs: Int
  ) async throws -> [LandmarkPoint]? {
    if lastPoseDetectionAt > 0,
      timestampMs - lastPoseDetectionAt < Self.poseSampleMs
    {
      return recentPose
    }
    try await preparePose()
    guard let poseLandmarker else {
      throw DetectorError.modelUnavailable("pose landmarker")
    }

    lastPoseDetectionAt = timestampMs
    return poseLandmarks(
      from: try poseLandmarker.detect(
        videoFrame: image,
        timestampInMilliseconds: timestampMs
      ),
      timestampMs: timestampMs
    )
  }

  private func poseLandmarks(
    from result: PoseLandmarkerResult?,
    timestampMs: Int
  ) -> [LandmarkPoint]? {
    if let pose = result?.landmarks.first?.map(LandmarkPoint.init),
      LandmarkValidation.validPose(pose)
    {
      recentPose = pose
      recentPoseAt = timestampMs
      return pose
    }

    guard let recentPose, timestampMs - recentPoseAt <= Self.poseReuseMs else {
      return nil
    }
    return recentPose
  }

  private func hands(
    from result: HandLandmarkerResult,
    side: HandSide,
    isMirrored: Bool
  ) -> [[LandmarkPoint]] {
    result.landmarks.enumerated().compactMap { index, landmarks in
      let category = result.handedness[safe: index]?.first?.categoryName
      let detectedSide = Self.handSide(category: category, isMirrored: isMirrored)
      guard detectedSide == side || (side == .right && category == nil) else {
        return nil
      }
      return landmarks.map(LandmarkPoint.init)
    }
  }

  static func handSide(category: String?, isMirrored: Bool) -> HandSide? {
    let detected: HandSide?
    switch category {
    case "Right": detected = .right
    case "Left": detected = .left
    default: detected = nil
    }
    guard let detected, !isMirrored else { return detected }
    return detected == .right ? .left : .right
  }

  static func modelPoints(
    _ points: [LandmarkPoint],
    isMirrored: Bool
  ) -> [LandmarkPoint] {
    guard isMirrored else { return points }
    return points.map { point in
      LandmarkPoint(x: 1 - point.x, y: point.y, z: point.z)
    }
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
