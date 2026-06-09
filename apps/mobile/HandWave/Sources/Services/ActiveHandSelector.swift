import Foundation

struct ActiveHandSelector {
  private var active: HandSide?
  private var previousLeft: [LandmarkPoint]?
  private var previousRight: [LandmarkPoint]?

  mutating func select(_ frame: HandLandmarksFrame) -> HandSide? {
    let right = frame.rightHandLandmarks.first
    let left = frame.leftHandLandmarks.first
    guard right != nil || left != nil else {
      reset()
      return nil
    }

    let selected = selectActiveHand(right: right, left: left)
    active = selected
    previousRight = right
    previousLeft = left
    return selected
  }

  mutating func reset() {
    active = nil
    previousLeft = nil
    previousRight = nil
  }

  private func selectActiveHand(
    right: [LandmarkPoint]?,
    left: [LandmarkPoint]?
  ) -> HandSide? {
    guard let right else { return left == nil ? nil : .left }
    guard let left else { return .right }

    let rightMotion = Self.motion(previous: previousRight, current: right)
    let leftMotion = Self.motion(previous: previousLeft, current: left)

    if let active {
      let other: HandSide = active == .right ? .left : .right
      let activeMotion = active == .right ? rightMotion : leftMotion
      let otherMotion = other == .right ? rightMotion : leftMotion
      if otherMotion > 0.015, otherMotion > activeMotion + 0.012 {
        return other
      }
      return active
    }

    if abs(leftMotion - rightMotion) > 0.012 {
      return leftMotion > rightMotion ? .left : .right
    }

    return Self.handSpan(left) > Self.handSpan(right) ? .left : .right
  }

  private static func motion(
    previous: [LandmarkPoint]?,
    current: [LandmarkPoint]
  ) -> Double {
    guard let previous, previous.count == current.count else { return 0 }
    var total = 0.0
    for index in current.indices {
      let a = previous[index]
      let b = current[index]
      total += sqrt(
        pow(b.x - a.x, 2) + pow(b.y - a.y, 2) + pow((b.z ?? 0) - (a.z ?? 0), 2)
      )
    }
    return total / Double(current.count)
  }

  private static func handSpan(_ points: [LandmarkPoint]) -> Double {
    var minX = Double.infinity
    var maxX = -Double.infinity
    var minY = Double.infinity
    var maxY = -Double.infinity
    for point in points {
      minX = min(minX, point.x)
      maxX = max(maxX, point.x)
      minY = min(minY, point.y)
      maxY = max(maxY, point.y)
    }
    return sqrt(pow(maxX - minX, 2) + pow(maxY - minY, 2))
  }
}
