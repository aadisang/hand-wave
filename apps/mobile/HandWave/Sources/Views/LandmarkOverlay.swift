import SwiftUI

struct LandmarkOverlay: View {
  let frame: HandLandmarksFrame

  /// Visual constants for the skeleton, matched to the web client's
  /// `landmarks-overlay` (emerald hands, sky-blue pose) so both clients render
  /// identically.
  private enum Style {
    static let handPoint = Color(hex: 0x10B981).opacity(0.95) // emerald-500
    static let handLine = Color.white.opacity(0.85)
    static let posePoint = Color(hex: 0x60A5FA).opacity(0.85) // blue-400
    static let poseLine = Color(hex: 0x93C5FD).opacity(0.55) // blue-300
    static let handLineWidth: CGFloat = 3
    static let poseLineWidth: CGFloat = 2
    static let handRadius: CGFloat = 3
    static let poseRadius: CGFloat = 2.5
  }

  var body: some View {
    Canvas { context, size in
      guard !frame.isEmpty else { return }

      for pose in frame.poseLandmarks {
        drawConnections(
          Self.poseConnections,
          in: pose,
          on: &context,
          size: size,
          color: Style.poseLine,
          lineWidth: Style.poseLineWidth
        )
        drawPoints(pose, on: &context, size: size, color: Style.posePoint, radius: Style.poseRadius)
      }

      for hand in frame.rightHandLandmarks + frame.leftHandLandmarks {
        drawConnections(
          Self.handConnections,
          in: hand,
          on: &context,
          size: size,
          color: Style.handLine,
          lineWidth: Style.handLineWidth
        )
        drawPoints(hand, on: &context, size: size, color: Style.handPoint, radius: Style.handRadius)
      }
    }
    .allowsHitTesting(false)
  }

  private func drawConnections(
    _ connections: [(Int, Int)],
    in points: [LandmarkPoint],
    on context: inout GraphicsContext,
    size: CGSize,
    color: Color,
    lineWidth: CGFloat
  ) {
    var path = Path()
    for connection in connections {
      guard connection.0 < points.count, connection.1 < points.count else { continue }
      path.move(to: cgPoint(points[connection.0], in: size))
      path.addLine(to: cgPoint(points[connection.1], in: size))
    }
    context.stroke(path, with: .color(color), lineWidth: lineWidth)
  }

  private func drawPoints(
    _ points: [LandmarkPoint],
    on context: inout GraphicsContext,
    size: CGSize,
    color: Color,
    radius: CGFloat
  ) {
    var path = Path()
    for point in points {
      let center = cgPoint(point, in: size)
      path.addEllipse(
        in: CGRect(
          x: center.x - radius,
          y: center.y - radius,
          width: radius * 2,
          height: radius * 2
        )
      )
    }
    context.fill(path, with: .color(color))
  }

  private func cgPoint(_ point: LandmarkPoint, in size: CGSize) -> CGPoint {
    CGPoint(
      x: CGFloat(min(max(point.x, 0), 1)) * size.width,
      y: CGFloat(min(max(point.y, 0), 1)) * size.height
    )
  }

  private static let handConnections: [(Int, Int)] = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
  ]

  private static let poseConnections: [(Int, Int)] = [
    (0, 1), (1, 2), (2, 3), (3, 7),
    (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10),
    (11, 12), (11, 13), (13, 15),
    (15, 17), (15, 19), (15, 21), (17, 19),
    (12, 14), (14, 16), (16, 18),
    (16, 20), (16, 22), (18, 20),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (24, 26), (25, 27), (26, 28),
    (27, 29), (28, 30), (29, 31), (30, 32),
    (27, 31), (28, 32),
  ]
}
