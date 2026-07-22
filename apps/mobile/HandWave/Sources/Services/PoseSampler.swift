/// Pose moves slowly relative to hands, so detection runs at a reduced rate and
/// the last good pose bridges the gap between samples and short detector misses.
struct PoseSampler {
  private static let sampleIntervalMs = 1_000 / 12
  private static let reuseMs = 500

  private var lastPose: [LandmarkPoint]?
  private var lastPoseAt = 0
  private var lastSampleAt = 0

  mutating func sample(
    at timestampMs: Int,
    detect: () throws -> [LandmarkPoint]?
  ) rethrows -> [LandmarkPoint]? {
    if lastSampleAt == 0 || timestampMs - lastSampleAt >= Self.sampleIntervalMs {
      lastSampleAt = timestampMs
      if let pose = try detect() {
        lastPose = pose
        lastPoseAt = timestampMs
      }
    }
    guard let lastPose, timestampMs - lastPoseAt <= Self.reuseMs else { return nil }
    return lastPose
  }

  mutating func reset() {
    self = PoseSampler()
  }
}
