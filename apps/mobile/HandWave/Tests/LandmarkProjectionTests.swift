import CoreGraphics
import Testing

@testable import HandWave

struct LandmarkProjectionTests {
  @Test
  func mapsAspectFitPointsIntoLetterboxedImage() {
    let point = LandmarkProjection.point(
      LandmarkPoint(x: 0, y: 0, z: nil),
      imageSize: LandmarkImageSize(width: 720, height: 1_280),
      viewportSize: CGSize(width: 390, height: 844),
      previewMode: .fit
    )

    #expect(point.x == 0)
    #expect(abs(point.y - 75.333_333_333_333_31) < 0.001)
  }

  @Test
  func mapsAspectFillPointsIntoCroppedImage() {
    let point = LandmarkProjection.point(
      LandmarkPoint(x: 0, y: 0, z: nil),
      imageSize: LandmarkImageSize(width: 1_080, height: 1_920),
      viewportSize: CGSize(width: 390, height: 844),
      previewMode: .fill
    )

    #expect(abs(point.x + 42.375) < 0.001)
    #expect(point.y == 0)
  }
}
