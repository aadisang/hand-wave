import SwiftUI

enum Spacing {
  static let xs: CGFloat = 4
  static let sm: CGFloat = 8
  static let md: CGFloat = 12
  static let lg: CGFloat = 16
  static let xl: CGFloat = 24
}

enum Radius {
  static let lg: CGFloat = 14
}

enum Motion {
  static let overlay = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.16)
  static let standard = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.2)
}
