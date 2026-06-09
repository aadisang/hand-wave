enum LandmarkValidation {
  private static let requiredPoseIndices = [0, 11, 12]
  private static let minFrameCoordinate = -0.15
  private static let maxFrameCoordinate = 1.15

  static func validPose(_ points: [LandmarkPoint]) -> Bool {
    requiredPoseIndices.allSatisfy { index in
      guard let point = points[safe: index] else { return false }
      return validPoint(point) && inFrame(point)
    }
  }

  static func validFullPose(_ points: [LandmarkPoint]) -> Bool {
    points.count == 33 && validPose(points)
  }

  static func validHand(_ points: [LandmarkPoint]) -> Bool {
    points.count == 21 && points.allSatisfy(validPoint)
  }

  static func validPoint(_ point: LandmarkPoint) -> Bool {
    point.x.isFinite && point.y.isFinite && (point.z?.isFinite ?? true)
  }

  private static func inFrame(_ point: LandmarkPoint) -> Bool {
    (minFrameCoordinate...maxFrameCoordinate).contains(point.x)
      && (minFrameCoordinate...maxFrameCoordinate).contains(point.y)
  }
}
