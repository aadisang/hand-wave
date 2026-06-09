import Dependencies
import MWDATCamera

struct RecognizerClient: Sendable {
  var start: @Sendable () async throws -> Void
  var stop: @Sendable () async -> Void
  var process: @Sendable (VideoFrame) async throws -> Recognizer.Output
}

extension RecognizerClient: DependencyKey {
  static var liveValue: Self {
    let recognizer = Recognizer()
    return Self(
      start: {
        try await recognizer.start()
      },
      stop: {
        await recognizer.stop()
      },
      process: { frame in
        try await recognizer.process(frame)
      }
    )
  }

  static let previewValue = Self(
    start: {},
    stop: {},
    process: { _ in
      Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        error: nil
      )
    }
  )

  static let testValue = Self(
    start: {
      reportIssue("RecognizerClient.start is unimplemented")
    },
    stop: {
      reportIssue("RecognizerClient.stop is unimplemented")
    },
    process: { _ in
      reportIssue("RecognizerClient.process is unimplemented")
      return Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        error: nil
      )
    }
  )
}

extension DependencyValues {
  var recognizer: RecognizerClient {
    get { self[RecognizerClient.self] }
    set { self[RecognizerClient.self] = newValue }
  }
}
