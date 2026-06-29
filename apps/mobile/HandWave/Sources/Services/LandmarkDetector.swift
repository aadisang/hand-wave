import CoreMedia
import Foundation
import MediaPipeTasksVision

actor LandmarkDetector {
  enum PoseMode: Sendable {
    case fallback
    case required
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
  private var recentLandmarks = RecentLandmarks()
  private var lastSelectedHand: HandSide?
  private var recentPose: [LandmarkPoint]?
  private var recentPoseAt = 0
  private let imageBufferConverter = PixelBufferConverter()
  private static let poseReuseMs = 500

  func prepare() async throws {
    if handLandmarker != nil { return }

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
    if poseLandmarker == nil {
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
  }

  func detect(
    sampleBuffer: CMSampleBuffer,
    timestampMs rawTimestampMs: Int,
    poseMode: PoseMode
  ) async throws -> DetectResult {
    try await prepare()
    guard let handLandmarker else {
      throw DetectorError.modelUnavailable("landmarker")
    }
    let mediaPipeBuffer = try imageBufferConverter.bgraSampleBuffer(from: sampleBuffer)
    guard let image = try? MPImage(sampleBuffer: mediaPipeBuffer) else {
      throw DetectorError.invalidImage
    }

    let timestampMs = max(rawTimestampMs, lastTimestampMs + 1)
    lastTimestampMs = timestampMs

    let handResult = try handLandmarker.detect(
      videoFrame: image,
      timestampInMilliseconds: timestampMs
    )
    let pose = try await detectPose(
      in: image,
      timestampMs: timestampMs,
      mode: poseMode
    )

    let frame = HandLandmarksFrame(
      rightHandLandmarks: rightHands(from: handResult),
      leftHandLandmarks: leftHands(from: handResult),
      poseLandmarks: pose.map { [$0] } ?? []
    )
    let selectedHand = activeHandSelector.select(frame)
    if let selectedHand {
      lastSelectedHand = selectedHand
    }
    recentLandmarks.remember(frame, timestampMs: timestampMs)
    return DetectResult(
      inferenceFrame: LandmarkSelection.toInferenceFrame(
        frame,
        pose: pose,
        poseMode: poseMode,
        selectedHand: selectedHand ?? lastSelectedHand,
        timestampMs: timestampMs,
        recentLandmarks: recentLandmarks
      ),
      overlayFrame: frame
    )
  }

  func resetSelection() {
    activeHandSelector.reset()
    recentLandmarks.reset()
    lastSelectedHand = nil
    recentPose = nil
    recentPoseAt = 0
  }

  private func rightHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Right")
  }

  private func leftHands(from result: HandLandmarkerResult) -> [[LandmarkPoint]] {
    hands(from: result, matching: "Left")
  }

  private func detectPose(
    in image: MPImage,
    timestampMs: Int,
    mode: PoseMode
  ) async throws -> [LandmarkPoint]? {
    guard mode == .required else { return nil }
    try await preparePose()
    guard let poseLandmarker else {
      throw DetectorError.modelUnavailable("pose landmarker")
    }

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
