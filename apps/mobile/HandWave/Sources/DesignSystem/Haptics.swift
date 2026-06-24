import SwiftUI

enum Haptic {
  static let primaryTap = SensoryFeedback.impact(weight: .medium)
  static let toggle = SensoryFeedback.selection
  static let stop = SensoryFeedback.impact(flexibility: .rigid)
  static let recognized = SensoryFeedback.impact(weight: .light, intensity: 0.6)
  static let connected = SensoryFeedback.success
  static let streamLive = SensoryFeedback.start
  static let failure = SensoryFeedback.error
}
