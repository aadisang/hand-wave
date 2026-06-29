import Dependencies
import MWDATCamera

struct RecognizerClient: Sendable {
  var start: @Sendable () async throws -> Void
  var stop: @Sendable () async -> Void
  var setFrameRate: @Sendable (Double) async -> Void
  var process: @Sendable (VideoFrame) async throws -> Recognizer.Output
  var processCamera: @Sendable (CameraFrame) async throws -> Recognizer.Output
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
      setFrameRate: { frameRate in
        await recognizer.setFrameRate(frameRate)
      },
      process: { frame in
        try await recognizer.process(frame)
      },
      processCamera: { frame in
        try await recognizer.process(frame)
      }
    )
  }

  static let previewValue = Self(
    start: {},
    stop: {},
    setFrameRate: { _ in },
    process: { _ in
      Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        failure: nil
      )
    },
    processCamera: { _ in
      Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        failure: nil
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
    setFrameRate: { _ in
      reportIssue("RecognizerClient.setFrameRate is unimplemented")
    },
    process: { _ in
      reportIssue("RecognizerClient.process is unimplemented")
      return Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        failure: nil
      )
    },
    processCamera: { _ in
      reportIssue("RecognizerClient.processCamera is unimplemented")
      return Recognizer.Output(
        event: nil,
        overlayFrame: .empty,
        hasFrame: false,
        failure: nil
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
