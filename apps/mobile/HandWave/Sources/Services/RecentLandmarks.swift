struct RecentLandmarks {
  private struct Entry {
    let points: [LandmarkPoint]
    let timestampMs: Int
  }

  private var rightHand: Entry?
  private var leftHand: Entry?

  mutating func remember(_ frame: HandLandmarksFrame, timestampMs: Int) {
    if let right = frame.rightHandLandmarks.first, LandmarkValidation.validHand(right) {
      rightHand = Entry(points: right, timestampMs: timestampMs)
    }
    if let left = frame.leftHandLandmarks.first, LandmarkValidation.validHand(left) {
      leftHand = Entry(points: left, timestampMs: timestampMs)
    }
  }

  func hand(
    in frame: HandLandmarksFrame,
    side: HandSide,
    timestampMs: Int
  ) -> [LandmarkPoint]? {
    let current = LandmarkSelection.landmarks(in: frame, side: side)
    if let current, LandmarkValidation.validHand(current) {
      return current
    }

    let entry = side == .right ? rightHand : leftHand
    return recent(entry, timestampMs: timestampMs)
  }

  mutating func reset() {
    rightHand = nil
    leftHand = nil
  }

  private func recent(_ entry: Entry?, timestampMs: Int) -> [LandmarkPoint]? {
    guard let entry, timestampMs - entry.timestampMs <= InferCfg.Stream.holdMs else {
      return nil
    }
    return entry.points
  }
}
