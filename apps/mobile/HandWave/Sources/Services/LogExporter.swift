import Foundation
import OSLog
import SwiftUI
import UniformTypeIdentifiers

enum LogExporter {
  static func text() async throws -> String {
    try await Task.detached(priority: .utility) {
      let store = try OSLogStore(scope: .currentProcessIdentifier)
      let position = store.position(timeIntervalSinceLatestBoot: 0)
      let predicate = NSPredicate(format: "subsystem == %@", AppLog.subsystem)
      let entries = try store.getEntries(at: position, matching: predicate)
      let formatter = ISO8601DateFormatter()

      return entries.compactMap { entry -> String? in
        guard let entry = entry as? OSLogEntryLog else { return nil }
        return
          "\(formatter.string(from: entry.date)) [\(entry.level.label)] [\(entry.category)] \(entry.composedMessage)"
      }.joined(separator: "\n")
    }.value
  }
}

struct LogDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.plainText] }

  var text: String

  init(text: String) {
    self.text = text
  }

  init(configuration: ReadConfiguration) throws {
    let data = configuration.file.regularFileContents ?? Data()
    text = String(decoding: data, as: UTF8.self)
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: Data(text.utf8))
  }
}

extension OSLogEntryLog.Level {
  fileprivate var label: String {
    switch self {
    case .undefined: "default"
    case .debug: "debug"
    case .info: "info"
    case .notice: "notice"
    case .error: "error"
    case .fault: "fault"
    @unknown default: "unknown"
    }
  }
}
