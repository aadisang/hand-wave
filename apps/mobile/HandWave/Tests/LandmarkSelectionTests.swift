import Testing

@testable import HandWave

struct LandmarkSelectionTests {
  @Test
  func packsRealPose() {
    let hand = Self.hand(offset: 0.2)
    let pose = Self.pose(offset: 0.4)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [hand],
      leftHandLandmarks: []
    )

    recent.remember(frame, timestampMs: 100)
    let inference = LandmarkSelection.toInferenceFrame(
      frame,
      pose: pose,
      poseMode: .required,
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )

    #expect(inference?.landmarks.count == 54)
    #expect(Array(inference?.landmarks.prefix(21) ?? []) == hand)
    #expect(Array(inference?.landmarks.suffix(33) ?? []) == pose)
  }

  @Test
  func usesSyntheticPoseOnlyInFallbackMode() {
    let hand = Self.hand(offset: 0.2)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [hand],
      leftHandLandmarks: []
    )

    recent.remember(frame, timestampMs: 100)
    let required = LandmarkSelection.toInferenceFrame(
      frame,
      pose: nil,
      poseMode: .required,
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )
    let fallback = LandmarkSelection.toInferenceFrame(
      frame,
      pose: nil,
      poseMode: .fallback,
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )

    #expect(required == nil)
    #expect(fallback?.landmarks.count == 54)
    #expect(fallback?.landmarks[21].x == hand[0].x)
    #expect(fallback?.landmarks[53].x == hand[0].x)
  }

  @Test
  func mirrorsLeftHandWithPose() throws {
    let hand = Self.hand(offset: 0.2)
    let pose = Self.pose(offset: 0.4)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [],
      leftHandLandmarks: [hand]
    )

    recent.remember(frame, timestampMs: 100)
    let inference = try #require(
      LandmarkSelection.toInferenceFrame(
        frame,
        pose: pose,
        poseMode: .required,
        selectedHand: .left,
        timestampMs: 100,
        recentLandmarks: recent
      )
    )

    #expect(inference.landmarks.count == 54)
    #expect(inference.landmarks[0].x == 1 - hand[0].x)
    #expect(inference.landmarks[21].x == 1 - pose[0].x)
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

  private static func pose(offset: Double) -> [LandmarkPoint] {
    (0..<33).map { index in
      LandmarkPoint(
        x: offset + Double(index) * 0.001,
        y: 0.5 + Double(index) * 0.001,
        z: Double(index) * 0.001
      )
    }
  }
}
