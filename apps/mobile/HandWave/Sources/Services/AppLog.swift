import Foundation
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

  static var environmentSummary: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
    let build = info?["CFBundleVersion"] as? String ?? "unknown"
    let sdkVersion =
      Bundle.allFrameworks
      .first { $0.bundleURL.lastPathComponent == "MWDATCore.framework" }?
      .infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
    let os = ProcessInfo.processInfo.operatingSystemVersionString

    return
      "app_version=\(version) build=\(build) mwdat_version=\(sdkVersion) os=\(os)"
  }

  static func recordLaunch() {
    app.notice("App launched \(environmentSummary, privacy: .public)")
  }
}
