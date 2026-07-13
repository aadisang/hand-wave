import Foundation
import Testing

@testable import HandWave

@Suite
struct InferSessionTests {
  @Test(arguments: [12, 30, 60, 120])
  func captureRateDoesNotChangeModelCadence(sourceFPS: Int) async throws {
    let client = RecordingInferAPI(responseText: "hello")
    let session = InferSession(client: client)
    try await session.start()

    let step = 1_000 / sourceFPS
    for timestamp in stride(from: 0, through: 850, by: step) {
      _ = try await session.ingest(Self.frame(at: timestamp), at: timestamp)
      await Task.yield()
    }

    let frameCount = await client.firstBatchCount
    #expect(frameCount != nil)
    #expect((18...21).contains(frameCount ?? 0))
  }

  @Test
  func deliversNetworkPredictionsWithoutAnotherFrame() async throws {
    let client = RecordingInferAPI(responseText: "hello")
    let events = EventRecorder()
    let session = InferSession(client: client)
    await session.setEventHandler { event in
      await events.append(event)
    }
    try await session.start()

    try await Self.feedMovement(to: session, through: 756)

    await events.waitForCount(1)
    let event = await events.first
    #expect(Self.partialText(event) == "hello")
  }

  @Test
  func keepsIngestingWhilePredictionRuns() async throws {
    let client = BlockingInferAPI(responseText: "go")
    let session = InferSession(client: client)
    try await session.start()
    try await Self.feedMovement(to: session, through: 800)
    await client.waitUntilStarted()

    let start = ContinuousClock.now
    _ = try await session.ingest(Self.frame(at: 850), at: 850)
    #expect(start.duration(to: .now) < .milliseconds(100))

    await client.complete()
  }

  @Test
  func waitsForPartialBeforeFinalizingLostLandmarks() async throws {
    let client = BlockingInferAPI(responseText: "thanks")
    let events = EventRecorder()
    let session = InferSession(client: client)
    await session.setEventHandler { event in
      await events.append(event)
    }
    try await session.start()
    try await Self.feedMovement(to: session, through: 800)
    await client.waitUntilStarted()

    for timestamp in stride(from: 850, through: 1_300, by: 50) {
      _ = try await session.ingest(nil, at: timestamp)
    }
    _ = try await session.ingest(Self.frame(at: 1_400), at: 1_400)
    #expect(await events.values.isEmpty)

    await client.complete()
    await events.waitForCount(2)
    let values = await events.values
    let finalFrameTimestamp = await client.finalFrameTimestamp
    #expect(Self.partialText(values.first) == "thanks")
    #expect(Self.finalizedText(values.last) == "thanks")
    #expect((finalFrameTimestamp ?? .max) < 1_400)
  }

  @Test
  func stopDiscardsAStaleResponse() async throws {
    let client = BlockingInferAPI(responseText: "stale")
    let events = EventRecorder()
    let session = InferSession(client: client)
    await session.setEventHandler { event in
      await events.append(event)
    }
    try await session.start()
    try await Self.feedMovement(to: session, through: 800)
    await client.waitUntilStarted()

    await session.stop()
    await client.complete()
    for _ in 0..<20 { await Task.yield() }

    #expect(await events.values.isEmpty)
  }

  @Test
  func surfacesDecodeFailureOnNextFrame() async throws {
    let failure = InferenceFailure.badStatus(URL(string: "https://example.test")!, 503)
    let client = FailingInferAPI(failure: failure)
    let session = InferSession(client: client)
    try await session.start()
    try await Self.feedMovement(to: session, through: 756)
    await client.waitUntilCalled()

    await #expect(throws: InferenceFailure.self) {
      _ = try await session.ingest(Self.frame(at: 850), at: 850)
    }
  }

  @Test
  func clearsWhenLandmarksDisappearBeforeMovement() async throws {
    let client = RecordingInferAPI(responseText: "hello")
    let session = InferSession(client: client)
    try await session.start()

    let event = try await session.ingest(nil, at: 0)

    #expect(event == .clear)
    #expect(await client.recognizeCount == 0)
  }

  @Test
  func producesTheBackendFeatureWidth() {
    let features = Self.frame(at: 0).inferenceFeatures
    #expect(features.count == 162)
  }

  private static func feedMovement(
    to session: InferSession,
    through end: Int,
    step: Int = 42
  ) async throws {
    for timestamp in stride(from: 0, through: end, by: step) {
      _ = try await session.ingest(frame(at: timestamp), at: timestamp)
      await Task.yield()
    }
  }

  private static func frame(at timestamp: Int) -> LandmarkFrame {
    let offset = Double(timestamp) / 1_000
    return LandmarkFrame(
      landmarks: (0..<54).map { index in
        LandmarkPoint(
          x: offset + Double(index) * 0.001,
          y: Double(index) * 0.001,
          z: nil
        )
      },
      timestampMs: timestamp
    )
  }

  private static func partialText(_ event: RecognitionEvent?) -> String? {
    guard case .partial(let prediction) = event else { return nil }
    return prediction.text
  }

  private static func finalizedText(_ event: RecognitionEvent?) -> String? {
    guard case .finalized(let prediction) = event else { return nil }
    return prediction.text
  }
}

@MainActor
private final class EventRecorder {
  private(set) var values: [RecognitionEvent] = []
  var first: RecognitionEvent? { values.first }

  func append(_ event: RecognitionEvent) {
    values.append(event)
  }

  func waitForCount(_ count: Int) async {
    for _ in 0..<200 where values.count < count {
      await Task.yield()
    }
  }
}

private actor RecordingInferAPI: InferAPI {
  private let responseText: String
  private(set) var recognizeCount = 0
  private(set) var firstBatchCount: Int?

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
    firstBatchCount = firstBatchCount ?? frames.count
    return recognitionResponse(text: responseText, context: context, finalize: finalize)
  }
}

private actor BlockingInferAPI: InferAPI {
  private let responseText: String
  private var continuation: CheckedContinuation<InferenceRecognizeOut, Never>?
  private var started = false
  private(set) var finalFrameTimestamp: Int?

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
      finalFrameTimestamp = frames.last?.timestampMs
      return recognitionResponse(text: responseText, context: context, finalize: true)
    }
    started = true
    return await withCheckedContinuation { continuation = $0 }
  }

  func waitUntilStarted() async {
    for _ in 0..<200 where !started {
      await Task.yield()
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
  private var wasCalled = false

  init(failure: InferenceFailure) {
    self.failure = failure
  }

  func recognize(
    frames: [LandmarkFrame],
    state: InferenceRecognitionState?,
    context: InferenceRecognitionContext,
    finalize: Bool
  ) async throws(InferenceFailure) -> InferenceRecognizeOut {
    wasCalled = true
    throw failure
  }

  func waitUntilCalled() async {
    for _ in 0..<200 where !wasCalled {
      await Task.yield()
    }
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
