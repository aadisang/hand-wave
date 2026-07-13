import CoreMedia
import Testing

@testable import HandWave

struct PhoneCameraTests {
  @Test
  func clampsAnApproximateSixtyFPSDurationToTheExactSupportedMinimum() {
    let exactMinimum = CMTime(value: 10_001, timescale: 600_000)
    let duration = PhoneCamera.frameDuration(
      for: 60,
      minimum: exactMinimum,
      maximum: CMTime(value: 1, timescale: 1)
    )

    #expect(duration == exactMinimum)
  }

  @Test
  func preservesARequestedDurationInsideTheSupportedRange() {
    let duration = PhoneCamera.frameDuration(
      for: 30,
      minimum: CMTime(value: 1, timescale: 60),
      maximum: CMTime(value: 1, timescale: 1)
    )

    #expect(duration == CMTime(value: 1, timescale: 30))
  }
}
