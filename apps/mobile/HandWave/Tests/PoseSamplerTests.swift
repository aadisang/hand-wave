import Testing

@testable import HandWave

struct PoseSamplerTests {
  private static let pose = [LandmarkPoint(x: 0.5, y: 0.5, z: 0)]

  @Test
  func throttlesDetectionBetweenSamples() {
    var sampler = PoseSampler()
    var detections = 0

    #expect(
      sampler.sample(at: 100) {
        detections += 1
        return Self.pose
      } == Self.pose
    )
    #expect(
      sampler.sample(at: 110) {
        detections += 1
        return nil
      } == Self.pose
    )
    #expect(detections == 1)
  }

  @Test
  func reusesTheLastGoodPoseThroughShortMissesOnly() {
    var sampler = PoseSampler()

    #expect(sampler.sample(at: 100) { Self.pose } == Self.pose)
    #expect(sampler.sample(at: 400) { nil } == Self.pose)
    #expect(sampler.sample(at: 700) { nil } == nil)
  }

  @Test
  func forgetsTheHeldPoseOnReset() {
    var sampler = PoseSampler()

    #expect(sampler.sample(at: 100) { Self.pose } == Self.pose)
    sampler.reset()
    #expect(sampler.sample(at: 110) { nil } == nil)
  }
}
