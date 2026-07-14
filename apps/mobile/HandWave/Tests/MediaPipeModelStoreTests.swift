import Foundation
import Testing

@testable import HandWave

@Suite
struct MediaPipeModelStoreTests {
  @Test
  func bundlesHandLandmarkerModel() throws {
    try expectBundledModel("hand_landmarker")
  }

  @Test
  func bundlesPoseLandmarkerModel() throws {
    try expectBundledModel("pose_landmarker_lite")
  }

  private func expectBundledModel(_ resource: String) throws {
    let url = try #require(
      Bundle.main.url(forResource: resource, withExtension: "task", subdirectory: "Models")
        ?? Bundle.main.url(forResource: resource, withExtension: "task")
    )
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
    #expect((size ?? 0) > 1_000_000)
  }
}
