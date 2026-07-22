import Testing

@testable import HandWave

struct ActiveHandSelectorTests {
  @Test
  func choosesOnlyVisibleHand() {
    var selector = ActiveHandSelector()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [],
      leftHandLandmarks: [Self.hand(offset: 0)]
    )

    #expect(selector.select(frame) == .left)
  }

  @Test
  func switchesWhenOtherHandMovesClearlyMore() {
    var selector = ActiveHandSelector()
    _ = selector.select(
      HandLandmarksFrame(
        rightHandLandmarks: [Self.hand(offset: 0)],
        leftHandLandmarks: [Self.hand(offset: 0)]
      )
    )

    let selected = selector.select(
      HandLandmarksFrame(
        rightHandLandmarks: [Self.hand(offset: 0.001)],
        leftHandLandmarks: [Self.hand(offset: 0.05)]
      )
    )

    #expect(selected == .left)
  }

  @Test
  func keepsOneHandAfterThatHandStartsThePhrase() {
    var selector = ActiveHandSelector()
    _ = selector.select(
      HandLandmarksFrame(
        rightHandLandmarks: [Self.hand(offset: 0)],
        leftHandLandmarks: [Self.hand(offset: 0)]
      )
    )
    #expect(
      selector.select(
        HandLandmarksFrame(
          rightHandLandmarks: [Self.hand(offset: 0.04)],
          leftHandLandmarks: [Self.hand(offset: 0)]
        )
      ) == .right
    )

    #expect(
      selector.select(
        HandLandmarksFrame(
          rightHandLandmarks: [Self.hand(offset: 0.05)],
          leftHandLandmarks: [Self.hand(offset: 0.2)]
        )
      ) == .right
    )
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
