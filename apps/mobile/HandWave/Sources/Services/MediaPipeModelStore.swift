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
      return localURL.path
    }

    let (downloadURL, response) = try await URLSession.shared.download(from: remoteURL)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw StoreError.unavailable(fileName)
    }
    try FileManager.default.moveItem(at: downloadURL, to: localURL)
    return localURL.path
  }
}
