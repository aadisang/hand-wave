enum LandmarkSelection {
  typealias PoseMode = LandmarkDetector.PoseMode

  static func toInferenceFrame(
    _ frame: HandLandmarksFrame,
    pose: [LandmarkPoint]?,
    poseMode: PoseMode,
    selectedHand: HandSide?,
    timestampMs: Int,
    recentLandmarks: RecentLandmarks
  ) -> LandmarkFrame? {
    let right = recentLandmarks.hand(in: frame, side: .right, timestampMs: timestampMs)
    let left = recentLandmarks.hand(in: frame, side: .left, timestampMs: timestampMs)
    guard right != nil || left != nil else { return nil }

    let side =
      selectedHand.flatMap {
        recentLandmarks.hand(in: frame, side: $0, timestampMs: timestampMs) == nil ? nil : $0
      }
      ?? preferredVisibleSide(in: frame)
      ?? (right != nil ? .right : .left)
    guard let sourceHand = recentLandmarks.hand(in: frame, side: side, timestampMs: timestampMs)
    else { return nil }
    guard let sourcePose = pose ?? fallbackPose(from: sourceHand, mode: poseMode) else {
      return nil
    }

    let useLeft = side == .left
    let modelHand = useLeft ? mirror(sourceHand) : sourceHand
    let alignedPose = useLeft ? mirror(sourcePose) : sourcePose
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

  private static func fallbackPose(
    from hand: [LandmarkPoint],
    mode: PoseMode
  ) -> [LandmarkPoint]? {
    guard mode == .fallback else { return nil }
    precondition(!hand.isEmpty, "Synthetic pose requires a hand")
    let wrist = hand[0]
    return Array(
      repeating: LandmarkPoint(x: wrist.x, y: wrist.y, z: wrist.z ?? 0),
      count: 33
    )
  }
}
