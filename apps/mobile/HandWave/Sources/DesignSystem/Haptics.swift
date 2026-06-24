import SwiftUI

// The app's haptic "voice" — a small, consistent vocabulary mapped onto
// SwiftUI's native `sensoryFeedback`. Each token corresponds to one kind of
// event so the feel stays coherent across screens. Driven declaratively off
// state via `.sensoryFeedback(_:trigger:)`; no imperative `UIFeedbackGenerator`.

enum Haptic {
  /// Pressing the main call-to-action (Connect / Start).
  static let primaryTap = SensoryFeedback.impact(weight: .medium)
  /// Toggling something on/off.
  static let toggle = SensoryFeedback.selection
  /// A firm, decisive press — stopping the stream.
  static let stop = SensoryFeedback.impact(flexibility: .rigid)
  /// A crisp tick each time a sign is recognized — the signature moment.
  static let recognized = SensoryFeedback.impact(weight: .light, intensity: 0.6)
  /// Glasses successfully connected.
  static let connected = SensoryFeedback.success
  /// The camera stream goes live.
  static let streamLive = SensoryFeedback.start
  /// Something went wrong.
  static let failure = SensoryFeedback.error
}
