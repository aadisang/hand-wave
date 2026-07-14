import Foundation

enum MediaPipeModelStore {
  enum StoreError: Error, LocalizedError {
    case unavailable(String)

    var errorDescription: String? {
      switch self {
      case .unavailable(let name):
        "Could not load the \(name) MediaPipe model."
      }
    }
  }

  static func path(
    resource: String,
    fileName: String,
    remoteURL: URL
  ) async throws -> String {
    if let bundled = Bundle.main.path(
      forResource: resource,
      ofType: "task",
      inDirectory: "Models"
    ) ?? Bundle.main.path(forResource: resource, ofType: "task") {
      AppLog.inference.notice("Using bundled MediaPipe model: \(fileName, privacy: .public)")
      return bundled
    }

    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appending(path: "MediaPipeModels", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )

    let localURL = directory.appending(path: fileName)
    if FileManager.default.fileExists(atPath: localURL.path) {
      AppLog.inference.notice("Using cached MediaPipe model: \(fileName, privacy: .public)")
      return localURL.path
    }

    AppLog.inference.notice("Downloading MediaPipe model: \(fileName, privacy: .public)")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 30
    let session = URLSession(configuration: configuration)
    let (downloadURL, response) = try await session.download(from: remoteURL)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw StoreError.unavailable(fileName)
    }
    try FileManager.default.moveItem(at: downloadURL, to: localURL)
    AppLog.inference.notice("MediaPipe model downloaded: \(fileName, privacy: .public)")
    return localURL.path
  }
}
