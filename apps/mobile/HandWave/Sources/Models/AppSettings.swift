import Foundation

enum AppSettingKey {
  static let inferenceMode = "inferenceMode"
  static let showsLandmarks = "showsLandmarks"
  static let showsPoseLandmarks = "showsPoseLandmarks"
}

enum InferenceMode: String, CaseIterable, Identifiable, Sendable {
  case remote
  case device

  var id: Self { self }
  var title: String { self == .remote ? "Cloud" : "On Device" }
  var systemImage: String { self == .remote ? "icloud" : "iphone" }

  static var selected: Self {
    let value = UserDefaults.standard.string(forKey: AppSettingKey.inferenceMode)
    return value.flatMap(Self.init(rawValue:)) ?? .remote
  }
}
