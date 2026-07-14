import OSLog

enum AppLog {
  static let subsystem = "sh.handwave.HandWave"

  static let app = Logger(subsystem: subsystem, category: "app")
  static let camera = Logger(subsystem: subsystem, category: "camera")
  static let inference = Logger(subsystem: subsystem, category: "inference")
  static let performance = OSSignposter(subsystem: subsystem, category: "performance")
  static let speech = Logger(subsystem: subsystem, category: "speech")
  static let stream = Logger(subsystem: subsystem, category: "stream")
  static let wearables = Logger(subsystem: subsystem, category: "wearables")
}
