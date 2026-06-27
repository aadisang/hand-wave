import Testing

@testable import HandWave

struct LandmarkSelectionTests {
  @Test
  func createsInferenceFrameWithoutPose() {
    let hand = Self.hand(offset: 0.2)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [hand],
      leftHandLandmarks: [],
      poseLandmarks: []
    )

    recent.remember(frame, timestampMs: 100)
    let inference = LandmarkSelection.toInferenceFrame(
      frame,
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )

    #expect(inference?.landmarks.count == 54)
    #expect(Array(inference?.landmarks.prefix(21) ?? []) == hand)
    #expect(inference?.landmarks[21].x == hand[0].x)
    #expect(inference?.landmarks[21].y == hand[0].y)
    #expect(inference?.landmarks[21].z == 0)
    #expect(inference?.landmarks[53].x == hand[0].x)
    #expect(inference?.landmarks[53].y == hand[0].y)
    #expect(inference?.landmarks[53].z == 0)
  }

  @Test
  func mirrorsLeftHandWithSyntheticPose() throws {
    let hand = Self.hand(offset: 0.2)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [],
      leftHandLandmarks: [hand],
      poseLandmarks: []
    )

    recent.remember(frame, timestampMs: 100)
    let inference = try #require(
      LandmarkSelection.toInferenceFrame(
        frame,
        selectedHand: .left,
        timestampMs: 100,
        recentLandmarks: recent
      )
    )

    #expect(inference.landmarks.count == 54)
    #expect(inference.landmarks[0].x == 1 - hand[0].x)
    #expect(inference.landmarks[21].x == 1 - hand[0].x)
  }

  private static func hand(offset: Double) -> [LandmarkPoint] {
    (0..<21).map { index in
      LandmarkPoint(
        x: offset + Double(index) * 0.001,
        y: 0.3 + Double(index) * 0.001,
        z: nil
      )
    }
  }
}
