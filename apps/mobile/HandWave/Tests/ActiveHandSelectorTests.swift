import Testing

@testable import HandWave

struct ActiveHandSelectorTests {
  @Test
  func choosesOnlyVisibleHand() {
    var selector = ActiveHandSelector()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [],
      leftHandLandmarks: [Self.hand(offset: 0)],
      poseLandmarks: []
    )

    #expect(selector.select(frame) == .left)
  }

  @Test
  func switchesWhenOtherHandMovesClearlyMore() {
    var selector = ActiveHandSelector()
    _ = selector.select(
      HandLandmarksFrame(
        rightHandLandmarks: [Self.hand(offset: 0)],
        leftHandLandmarks: [Self.hand(offset: 0)],
        poseLandmarks: []
      )
    )

    let selected = selector.select(
      HandLandmarksFrame(
        rightHandLandmarks: [Self.hand(offset: 0.001)],
        leftHandLandmarks: [Self.hand(offset: 0.05)],
        poseLandmarks: []
      )
    )

    #expect(selected == .left)
  }

  private static func hand(offset: Double) -> [LandmarkPoint] {
    (0..<21).map { index in
      LandmarkPoint(
        x: offset + Double(index) * 0.001,
        y: Double(index) * 0.001,
        z: nil
      )
    }
  }
}
