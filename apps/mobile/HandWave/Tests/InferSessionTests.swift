import Foundation
import Testing

@testable import HandWave

@Suite
struct InferSessionTests {
  @Test
  func finalizesPredictionAfterIdleFrames() async throws {
    let client = BlockingInferAPI(responseText: "hello")
    let controller = InferSession(client: client)
    try await controller.start()

    var lastEvent: InferSession.Event?
    for index in 0..<InferCfg.Stream.min {
      lastEvent = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
    }
    await Self.waitForPredictionStart(client)
    await client.complete()
    lastEvent = try await Self.nextEvent(from: controller, offset: 0.24)

    #expect(Self.text(from: lastEvent) == "hello")

    for _ in 0..<(InferCfg.Stream.idle + 2) {
      if let event = try await controller.ingest(Self.frame(offset: 0.24)) {
        lastEvent = event
      }
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
    #expect(await client.recognizeCount == 0)
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

  @Test
  func preservesDelayedPredictionWhenLandmarksDropBeforeResponse() async throws {
    let client = BlockingInferAPI(responseText: "cat")
    let controller = InferSession(client: client)
    try await controller.start()

    for index in 0..<InferCfg.Stream.min {
      _ = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
    }
    await Self.waitForPredictionStart(client)

    for _ in 0..<(InferCfg.Stream.lost + 2) {
      let event = try await controller.ingest(nil)
      #expect(event == nil)
    }

    await client.complete()
    for _ in 0..<100 {
      await Task.yield()
    }

    let partial = try await controller.ingest(nil)
    #expect(Self.text(from: partial) == "cat")

    let finalized = try await controller.ingest(nil)
    #expect(Self.finalizedText(from: finalized) == "cat")
  }

  @Test
  func surfacesDecodeFailureOnNextIngest() async throws {
    let failure = InferenceFailure.badStatus(URL(string: "https://example.test")!, 503)
    let client = FailingInferAPI(failure: failure)
    let controller = InferSession(client: client)
    try await controller.start()

    for index in 0..<(InferCfg.Stream.min + InferCfg.Stream.stride) {
      _ = try await controller.ingest(Self.frame(offset: Double(index) * 0.01))
      if await client.recognizeCount > 0 { break }
    }
    await Self.waitForFailingRecognition(client)

    do {
      _ = try await controller.ingest(Self.frame(offset: 0.24))
      Issue.record("Expected pending inference failure to be surfaced")
    } catch {
      #expect(error == failure)
    }
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
    for _ in 0..<100 {
      await Task.yield()
    }
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

  private static func waitForFailingRecognition(_ client: FailingInferAPI) async {
    for _ in 0..<100 {
      if await client.recognizeCount > 0 { return }
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
  private(set) var recognizeCount = 0

  init(responseText: String) {
    self.responseText = responseText
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    recognizeCount += 1
    return recognitionResponse(text: responseText, context: context, finalize: finalize)
  }
}

private actor BlockingInferAPI: InferAPI {
  private let responseText: String
  private var continuation: CheckedContinuation<InferenceRecognizeOut, Never>?
  private(set) var started = false

  init(responseText: String) {
    self.responseText = responseText
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    if finalize {
      return recognitionResponse(text: responseText, context: context, finalize: true)
    }

    started = true
    return await withCheckedContinuation { continuation in
      self.continuation = continuation
    }
  }

  func complete() {
    continuation?.resume(
      returning: recognitionResponse(
        text: responseText,
        context: InferenceRecognitionContext(
          idleFrames: 0,
          missingFrames: 0,
          segmentFrames: 0,
          motion: 0
        ),
        finalize: false
      )
    )
    continuation = nil
  }
}

private actor FailingInferAPI: InferAPI {
  private let failure: InferenceFailure
  private(set) var recognizeCount = 0

  init(failure: InferenceFailure) {
    self.failure = failure
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    recognizeCount += 1
    throw failure
  }
}

private func recognitionResponse(
  text: String,
  context: InferenceRecognitionContext,
  finalize: Bool
) -> InferenceRecognizeOut {
  let prediction = InferencePrediction(
    label: text,
    confidence: 0.92,
    logitScore: nil,
    lmScore: 0.1,
    rawLabel: nil
  )
  return InferenceRecognizeOut(
    state: InferenceRecognitionState(
      display: nil,
      finalCandidate: nil,
      selectedText: text,
      selectedStreak: 1,
      displayMisses: 0,
      counts: []
    ),
    displayPrediction: prediction,
    committed: finalize,
    trace: InferenceRecognitionTrace(
      decode: finalize
        ? nil
        : InferenceDecodeTrace(
          bufferedFrames: 1,
          inputText: text,
          displayText: text,
          idleFrames: context.idleFrames,
          motion: context.motion,
          latencyMs: 1
        ),
      finalize: finalize
        ? InferenceFinalizeTrace(
          text: text,
          confidence: prediction.confidence,
          committed: true,
          endpointReason: context.endpointReason ?? .idle,
          segmentFrames: context.segmentFrames
        )
        : nil
    )
  )
}
