import Testing

@testable import HandWave

@Suite
struct InferSessionTests {
  @Test
  func finalizesPredictionAfterIdleFrames() async throws {
    let client = MockInferAPI(responseText: "hello")
    let controller = InferSession(client: client)
    try await controller.start()

    var lastEvent: InferSession.Event?
    for index in 0..<InferCfg.Stream.min {
      lastEvent = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
    }

    #expect(Self.text(from: lastEvent) == "hello")

    for _ in 0..<InferCfg.Stream.idle {
      lastEvent = try await controller.ingest(Self.frame(offset: 0.23))
    }

    #expect(Self.finalizedText(from: lastEvent) == "hello")
    #expect(await client.resetCount == 1)
  }

  @Test
  func finalizesPredictionWhenLandmarksAreLost() async throws {
    let client = MockInferAPI(responseText: "thanks")
    let controller = InferSession(client: client)
    try await controller.start()

    var lastEvent: InferSession.Event?
    for index in 0..<InferCfg.Stream.min {
      lastEvent = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
    }

    #expect(Self.text(from: lastEvent) == "thanks")

    for _ in 0..<InferCfg.Stream.lost {
      lastEvent = try await controller.ingest(nil)
    }

    #expect(Self.finalizedText(from: lastEvent) == "thanks")
    #expect(await client.resetCount == 1)
  }

  @Test
  func clearsDisplayWhenLandmarksDisappearBeforeDecode() async throws {
    let client = MockInferAPI(responseText: "hello")
    let controller = InferSession(client: client)
    try await controller.start()

    let event = try await controller.ingest(nil)

    #expect(event == .clear)
    #expect(await client.appendCount == 0)
    #expect(await client.resetCount == 0)
  }

  private static func frame(offset: Double) -> LandmarkFrame {
    LandmarkFrame(
      landmarks: (0..<21).map { index in
        LandmarkPoint(
          x: offset + Double(index) * 0.001,
          y: Double(index) * 0.001,
          z: nil
        )
      },
      timestampMs: Int((offset * 1_000).rounded())
    )
  }

  private static func text(from event: InferSession.Event?) -> String? {
    guard case .partial(let prediction) = event else { return nil }
    return prediction.text
  }

  private static func finalizedText(from event: InferSession.Event?) -> String? {
    guard case .finalized(let prediction) = event else { return nil }
    return prediction.text
  }
}

private actor MockInferAPI: InferAPI {
  private let responseText: String
  private(set) var appendCount = 0
  private(set) var resetCount = 0

  init(responseText: String) {
    self.responseText = responseText
  }

  func createSession() async throws -> String {
    "test-session"
  }

  func appendFrames(
    sessionId: String,
    frames: [LandmarkFrame]
  ) async throws -> StreamPred {
    appendCount += 1
    return StreamPred(
      sessionId: sessionId,
      bufferedFrames: frames.count,
      prediction: Prediction(
        label: responseText,
        confidence: 0.92,
        logitScore: nil,
        lmScore: 0.1,
        rawLabel: nil
      ),
      alternatives: [],
      greedyText: responseText,
      partialText: responseText,
      stableText: responseText
    )
  }

  func resetSession(sessionId: String) async throws -> SessionState {
    resetCount += 1
    return SessionState(
      sessionId: sessionId,
      bufferedFrames: 0,
      partialText: "",
      stableText: ""
    )
  }

  func deleteSession(sessionId: String) async {}
}
