import CoreGraphics

enum LandmarkPreviewMode: Sendable {
  case fit
  case fill
}

enum LandmarkProjection {
  static func point(
    _ point: LandmarkPoint,
    imageSize: LandmarkImageSize?,
    viewportSize: CGSize,
    previewMode: LandmarkPreviewMode
  ) -> CGPoint {
    let x = CGFloat(min(max(point.x, 0), 1))
    let y = CGFloat(min(max(point.y, 0), 1))
    guard
      let imageSize,
      imageSize.width > 0,
      imageSize.height > 0,
      viewportSize.width > 0,
      viewportSize.height > 0
    else {
      return CGPoint(x: x * viewportSize.width, y: y * viewportSize.height)
    }

    let imageWidth = CGFloat(imageSize.width)
    let imageHeight = CGFloat(imageSize.height)
    let horizontalScale = viewportSize.width / imageWidth
    let verticalScale = viewportSize.height / imageHeight
    let scale =
      switch previewMode {
      case .fit: min(horizontalScale, verticalScale)
      case .fill: max(horizontalScale, verticalScale)
      }
    let displayedSize = CGSize(
      width: imageWidth * scale,
      height: imageHeight * scale
    )
    let origin = CGPoint(
      x: (viewportSize.width - displayedSize.width) / 2,
      y: (viewportSize.height - displayedSize.height) / 2
    )
    return CGPoint(
      x: origin.x + x * displayedSize.width,
      y: origin.y + y * displayedSize.height
    )
  }
}
