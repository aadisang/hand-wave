import Foundation
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
    lastEvent = try await Self.nextEvent(from: controller, offset: 0.24)

    #expect(Self.text(from: lastEvent) == "hello")

    for _ in 0..<InferCfg.Stream.idle {
      lastEvent = try await controller.ingest(Self.frame(offset: 0.24))
    }

    #expect(Self.finalizedText(from: lastEvent) == "hello")
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
    lastEvent = try await Self.nextEvent(from: controller, offset: 0.24)

    #expect(Self.text(from: lastEvent) == "thanks")

    for _ in 0..<InferCfg.Stream.lost {
      lastEvent = try await controller.ingest(nil)
    }

    #expect(Self.finalizedText(from: lastEvent) == "thanks")
  }

  @Test
  func clearsDisplayWhenLandmarksDisappearBeforeDecode() async throws {
    let client = MockInferAPI(responseText: "hello")
    let controller = InferSession(client: client)
    try await controller.start()

    let event = try await controller.ingest(nil)

    #expect(event == .clear)
    #expect(await client.predictCount == 0)
  }

  @Test
  func encodesLandmarkFramesAsBackendFeatures() throws {
    struct Request: Encodable {
      let frames: [LandmarkFrame]
    }

    let data = try JSONEncoder().encode(Request(frames: [Self.fullFrame()]))
    let object = try #require(
      JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    let frames = try #require(object["frames"] as? [[Double]])

    #expect(frames[0].count == 162)
    #expect(frames[0][0] == 0)
    #expect(frames[0][1] == 0)
    #expect(frames[0][2] == 0)
  }

  @Test
  func keepsIngestingWhilePredictionRuns() async throws {
    let client = BlockingInferAPI(responseText: "go")
    let controller = InferSession(client: client)
    try await controller.start()

    for index in 0..<InferCfg.Stream.min {
      _ = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
    }
    await Self.waitForPredictionStart(client)

    let start = ContinuousClock.now
    _ = try await controller.ingest(Self.frame(offset: 0.25))
    #expect(start.duration(to: .now) < .milliseconds(100))

    await client.complete()
    let event = try await Self.nextEvent(from: controller, offset: 0.26)

    #expect(Self.text(from: event) == "go")
  }

  private static func frame(offset: Double) -> LandmarkFrame {
    LandmarkFrame(
      landmarks: (0..<54).map { index in
        LandmarkPoint(
          x: offset + Double(index) * 0.001,
          y: Double(index) * 0.001,
          z: nil
        )
      },
      timestampMs: Int((offset * 1_000).rounded())
    )
  }

  private static func fullFrame() -> LandmarkFrame {
    frame(offset: 0)
  }

  private static func nextEvent(
    from controller: InferSession,
    offset: Double
  ) async throws -> InferSession.Event? {
    for index in 0..<10 {
      await Task.yield()
      if let event = try await controller.ingest(
        Self.frame(offset: offset + Double(index) * 0.001)
      ) {
        return event
      }
    }
    return nil
  }

  private static func waitForPredictionStart(_ client: BlockingInferAPI) async {
    for _ in 0..<100 {
      if await client.started { return }
      await Task.yield()
    }
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
  private(set) var predictCount = 0

  init(responseText: String) {
    self.responseText = responseText
  }

  func predict(frames: [LandmarkFrame]) async throws -> StreamPred {
    predictCount += 1
    return StreamPred(
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
}

private actor BlockingInferAPI: InferAPI {
  private let responseText: String
  private var continuation: CheckedContinuation<StreamPred, Never>?
  private(set) var started = false

  init(responseText: String) {
    self.responseText = responseText
  }

  func predict(frames: [LandmarkFrame]) async throws -> StreamPred {
    started = true
    return await withCheckedContinuation { continuation in
      self.continuation = continuation
    }
  }

  func complete() {
    continuation?.resume(returning: Self.response(text: responseText))
    continuation = nil
  }

  private static func response(text: String) -> StreamPred {
    StreamPred(
      prediction: Prediction(
        label: text,
        confidence: 0.92,
        logitScore: nil,
        lmScore: 0.1,
        rawLabel: nil
      ),
      alternatives: [],
      greedyText: text,
      partialText: text,
      stableText: text
    )
  }
}
