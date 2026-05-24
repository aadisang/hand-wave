import SwiftUI

struct StreamView: View {
  @Environment(AppModel.self) private var appModel

  var body: some View {
    ZStack(alignment: .bottom) {
      preview
      LandmarkOverlay(points: appModel.stream.overlayLandmarks)
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
  let points: [LandmarkPoint]

  var body: some View {
    Canvas { context, size in
      guard !points.isEmpty else { return }

      let handCount = min(42, points.count)
      var handPath = Path()
      for connection in Self.handConnections {
        guard connection.0 < handCount, connection.1 < handCount else { continue }
        let start = cgPoint(points[connection.0], in: size)
        let end = cgPoint(points[connection.1], in: size)
        handPath.move(to: start)
        handPath.addLine(to: end)
      }
      context.stroke(handPath, with: .color(.cyan), lineWidth: 3)

      var dotPath = Path()
      for point in points {
        let center = cgPoint(point, in: size)
        dotPath.addEllipse(
          in: CGRect(x: center.x - 3, y: center.y - 3, width: 6, height: 6)
        )
      }
      context.fill(dotPath, with: .color(.yellow))
    }
    .allowsHitTesting(false)
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
    (21, 22), (22, 23), (23, 24), (24, 25),
    (21, 26), (26, 27), (27, 28), (28, 29),
    (26, 30), (30, 31), (31, 32), (32, 33),
    (30, 34), (34, 35), (35, 36), (36, 37),
    (34, 38), (38, 39), (39, 40), (40, 41),
    (21, 38),
  ]
}
