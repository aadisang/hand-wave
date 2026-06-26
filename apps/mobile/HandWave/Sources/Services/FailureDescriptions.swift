import Foundation

enum FailureDescriptions {
  static func describe(_ error: any Error) -> String {
    if let description = (error as? LocalizedError)?.errorDescription,
      !description.isEmpty
    {
      return description
    }

    let nsError = error as NSError
    if !nsError.localizedDescription.isEmpty {
      return nsError.localizedDescription
    }

    return String(describing: error)
  }
}
