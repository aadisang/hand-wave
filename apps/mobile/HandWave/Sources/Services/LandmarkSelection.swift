enum LandmarkSelection {
  static func toInferenceFrame(
    _ frame: HandLandmarksFrame,
    selectedHand: HandSide?,
    timestampMs: Int,
    recentLandmarks: RecentLandmarks
  ) -> LandmarkFrame? {
    let right = recentLandmarks.hand(in: frame, side: .right, timestampMs: timestampMs)
    let left = recentLandmarks.hand(in: frame, side: .left, timestampMs: timestampMs)
    guard let pose = recentLandmarks.pose(in: frame, timestampMs: timestampMs),
      right != nil || left != nil
    else {
      return nil
    }

    let side =
      selectedHand.flatMap {
        recentLandmarks.hand(in: frame, side: $0, timestampMs: timestampMs) == nil ? nil : $0
      }
      ?? preferredVisibleSide(in: frame)
      ?? (right != nil ? .right : .left)
    guard let sourceHand = recentLandmarks.hand(in: frame, side: side, timestampMs: timestampMs)
    else { return nil }

    let useLeft = side == .left
    let modelHand = useLeft ? mirror(sourceHand) : sourceHand
    let alignedPose = useLeft ? mirror(pose) : pose
    guard modelHand.count == 21, alignedPose.count == 33 else { return nil }
    guard modelHand.allSatisfy(LandmarkValidation.validPoint),
      LandmarkValidation.validPose(alignedPose)
    else {
      return nil
    }

    return LandmarkFrame(
      landmarks: modelHand + alignedPose,
      timestampMs: timestampMs
    )
  }

  static func landmarks(
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

  private static func preferredVisibleSide(in frame: HandLandmarksFrame) -> HandSide? {
    if let right = landmarks(in: frame, side: .right), LandmarkValidation.validHand(right) {
      return .right
    }
    if let left = landmarks(in: frame, side: .left), LandmarkValidation.validHand(left) {
      return .left
    }
    return nil
  }

  private static func mirror(_ points: [LandmarkPoint]) -> [LandmarkPoint] {
    points.map { LandmarkPoint(x: 1 - $0.x, y: $0.y, z: $0.z) }
  }
}
