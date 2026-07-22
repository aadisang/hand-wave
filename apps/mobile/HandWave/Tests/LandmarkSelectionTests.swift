import Testing

@testable import HandWave

struct LandmarkSelectionTests {
  @Test
  func mapsHandednessFromMirroredAndUnmirroredFeeds() {
    #expect(LandmarkDetector.handSide(category: "Right", isMirrored: true) == .right)
    #expect(LandmarkDetector.handSide(category: "Left", isMirrored: true) == .left)
    #expect(LandmarkDetector.handSide(category: "Right", isMirrored: false) == .left)
    #expect(LandmarkDetector.handSide(category: "Left", isMirrored: false) == .right)
  }

  @Test
  func convertsMirroredFeedPointsToModelSpace() {
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [[LandmarkPoint(x: 0.2, y: 0.3, z: 0.4)]],
      leftHandLandmarks: [[LandmarkPoint(x: 0.6, y: 0.1, z: nil)]],
      poseLandmarks: [[LandmarkPoint(x: 1, y: 0.5, z: 0)]]
    )

    let mirrored = frame.mirroredHorizontally()

    #expect(mirrored.rightHandLandmarks == [[LandmarkPoint(x: 0.8, y: 0.3, z: 0.4)]])
    #expect(mirrored.leftHandLandmarks == [[LandmarkPoint(x: 0.4, y: 0.1, z: nil)]])
    #expect(mirrored.poseLandmarks == [[LandmarkPoint(x: 0, y: 0.5, z: 0)]])
  }

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
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )

    #expect(inference?.landmarks.count == 54)
    #expect(Array(inference?.landmarks.prefix(21) ?? []) == hand)
    #expect(Array(inference?.landmarks.suffix(33) ?? []) == pose)
  }

  @Test
  func rejectsFramesWithoutPose() {
    let hand = Self.hand(offset: 0.2)
    var recent = RecentLandmarks()
    let frame = HandLandmarksFrame(
      rightHandLandmarks: [hand],
      leftHandLandmarks: []
    )

    recent.remember(frame, timestampMs: 100)
    let inference = LandmarkSelection.toInferenceFrame(
      frame,
      pose: nil,
      selectedHand: .right,
      timestampMs: 100,
      recentLandmarks: recent
    )
    #expect(inference == nil)
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
