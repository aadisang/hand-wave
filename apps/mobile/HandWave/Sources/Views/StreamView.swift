import SwiftUI

struct StreamView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    ZStack(alignment: .bottom) {
      preview
      LandmarkOverlay(frame: appModel.stream.overlayFrame)
      VStack(spacing: 18) {
        predictionOverlay
        statusText
        stopButton
      }
      .padding(.horizontal, 24)
      .padding(.bottom, 36)
    }
    .background(.black)
    .ignoresSafeArea()
    .toolbar(.hidden, for: .navigationBar)
    .statusBarHidden()
  }

  private var statusText: some View {
    Text(appModel.stream.statusText)
      .font(.system(.footnote, design: .monospaced).weight(.semibold))
      .foregroundStyle(.white.opacity(0.78))
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(.black.opacity(0.42), in: Capsule())
  }

  @ViewBuilder
  private var preview: some View {
    if let frame = appModel.stream.latestFrame {
      Image(uiImage: frame)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: 14) {
        ProgressView()
          .tint(.white)
        Text("Starting camera")
          .font(.system(.footnote, design: .monospaced).weight(.semibold))
          .foregroundStyle(.white.opacity(0.72))
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(.black)
    }
  }

  @ViewBuilder
  private var predictionOverlay: some View {
    if let prediction = appModel.stream.current {
      VStack(spacing: 6) {
        Text(prediction.text)
          .font(.system(size: 44, weight: .bold, design: .rounded))
          .lineLimit(2)
          .minimumScaleFactor(0.55)
          .multilineTextAlignment(.center)
          .foregroundStyle(.white)
        Text("\(Int((prediction.confidence * 100).rounded()))%")
          .font(.system(.footnote, design: .monospaced).weight(.semibold))
          .foregroundStyle(.white.opacity(0.72))
      }
      .padding(.horizontal, 22)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity)
      .background(.black.opacity(0.48), in: RoundedRectangle(cornerRadius: 8))
      .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
  }

  private var stopButton: some View {
    Button {
      Task { await appModel.stream.stop() }
    } label: {
      Image(systemName: "stop.fill")
        .font(.system(size: 28, weight: .bold))
        .foregroundStyle(.white)
        .frame(width: 76, height: 76)
    }
    .buttonStyle(.glassProminent)
    .buttonBorderShape(.circle)
    .tint(.red)
  }
}

private struct LandmarkOverlay: View {
  let frame: HandLandmarksFrame

  var body: some View {
    Canvas { context, size in
      guard !frame.isEmpty else { return }

      for pose in frame.poseLandmarks {
        drawConnections(
          Self.poseConnections,
          in: pose,
          on: &context,
          size: size,
          color: .blue.opacity(0.55),
          lineWidth: 2
        )
        drawPoints(pose, on: &context, size: size, color: .blue.opacity(0.85), radius: 2.5)
      }

      for hand in frame.rightHandLandmarks + frame.leftHandLandmarks {
        drawConnections(
          Self.handConnections,
          in: hand,
          on: &context,
          size: size,
          color: .white.opacity(0.85),
          lineWidth: 3
        )
        drawPoints(hand, on: &context, size: size, color: .cyan, radius: 3)
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
