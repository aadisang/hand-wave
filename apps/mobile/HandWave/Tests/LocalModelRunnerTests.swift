import Testing

@testable import HandWave

@Suite
struct LocalModelRunnerTests {
  @Test
  func runsTheBundledRawLandmarkModel() async throws {
    let runner = LocalModelRunner()
    let frames = (0..<18).map { index in
      Self.frame(offset: 0.1 + Double(index) * 0.001, step: 0.01)
    }

    let emission = try await runner.infer(frames)

    #expect(emission.values.count == 9)
    #expect(emission.values.allSatisfy { $0.count == 60 })
    #expect(emission.frameConfidence >= 0)
    #expect(emission.frameConfidence <= 1)
  }

  private static func frame(offset: Double, step: Double) -> LandmarkFrame {
    LandmarkFrame(
      landmarks: (0..<54).map { index in
        let base = offset + Double(index * 3) * step
        return LandmarkPoint(x: base, y: base + step, z: base + step * 2)
      },
      timestampMs: 0
    )
  }
}
