import Testing

@testable import HandWave

struct FramePipelineStatsTests {
  @Test
  func subtractsAReportingBaseline() {
    let baseline = FramePipelineStats(
      receivedFrames: 10,
      processedFrames: 8,
      inferenceFrames: 6,
      supersededFrames: 2
    )
    let current = FramePipelineStats(
      receivedFrames: 15,
      processedFrames: 12,
      inferenceFrames: 9,
      supersededFrames: 3
    )

    #expect(
      current.subtracting(baseline)
        == FramePipelineStats(
          receivedFrames: 5,
          processedFrames: 4,
          inferenceFrames: 3,
          supersededFrames: 1
        )
    )
  }
}
