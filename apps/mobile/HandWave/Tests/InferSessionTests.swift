import Foundation
import Testing

@testable import HandWave

@Suite(.timeLimit(.minutes(1)))
struct InferSessionTests {
  @Test(arguments: [12, 30, 60, 120])
  func captureRateDoesNotChangeModelCadence(sourceFPS: Int) async throws {
    let client = RecordingInferAPI(responseText: "hello")
    let session = InferSession(client: client)
    try await session.start()

    let step = 1_000 / sourceFPS
    for timestamp in stride(from: 0, through: 850, by: step) {
      _ = try await session.ingest(Self.frame(at: timestamp), at: timestamp)
    }

    let frameCount = await client.waitForFirstBatch()
    #expect((18...21).contains(frameCount))
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

    _ = try await session.ingest(Self.frame(at: 850), at: 850)

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
  func finalizesAfterConfiguredIdleDuration() async throws {
    let client = RecordingInferAPI(responseText: "hello")
    let events = EventRecorder()
    let session = InferSession(client: client)
    await session.setEventHandler { event in
      await events.append(event)
    }
    let lastMotionAt = 840
    let idleDurationMs = InferCfg.Stream.idle * 1_000 / InferCfg.Stream.fps
    try await session.start()
    try await Self.feedMovement(to: session, through: lastMotionAt)
    await events.waitForCount(1)

    let beforeIdle = lastMotionAt + idleDurationMs - 1
    _ = try await session.ingest(
      Self.frame(at: beforeIdle, offset: 0.84),
      at: beforeIdle
    )
    await events.waitForCount(2)
    #expect(await client.finalizeCount == 0)

    let atIdle = lastMotionAt + idleDurationMs
    _ = try await session.ingest(
      Self.frame(at: atIdle, offset: 0.84),
      at: atIdle
    )
    await client.waitForFinalize()

    #expect(await client.finalizeCount == 1)
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
    }
  }

  private static func frame(at timestamp: Int, offset: Double? = nil) -> LandmarkFrame {
    let offset = offset ?? Double(timestamp) / 1_000
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
  private var waiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
  var first: RecognitionEvent? { values.first }

  func append(_ event: RecognitionEvent) {
    values.append(event)
    let ready = waiters.filter { values.count >= $0.count }
    waiters.removeAll { values.count >= $0.count }
    for waiter in ready {
      waiter.continuation.resume()
    }
  }

  func waitForCount(_ count: Int) async {
    guard values.count < count else { return }
    await withCheckedContinuation { continuation in
      waiters.append((count, continuation))
    }
  }
}

private actor RecordingInferAPI: InferAPI {
  private let responseText: String
  private(set) var recognizeCount = 0
  private(set) var finalizeCount = 0
  private(set) var firstBatchCount: Int?
  private var firstBatchWaiters: [CheckedContinuation<Int, Never>] = []
  private var finalizeWaiters: [CheckedContinuation<Void, Never>] = []

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
    if finalize {
      finalizeCount += 1
      let waiters = finalizeWaiters
      finalizeWaiters.removeAll()
      for waiter in waiters {
        waiter.resume()
      }
    }
    if firstBatchCount == nil {
      firstBatchCount = frames.count
      let waiters = firstBatchWaiters
      firstBatchWaiters.removeAll()
      for waiter in waiters {
        waiter.resume(returning: frames.count)
      }
    }
    return recognitionResponse(text: responseText, context: context, finalize: finalize)
  }

  func waitForFirstBatch() async -> Int {
    if let firstBatchCount { return firstBatchCount }
    return await withCheckedContinuation { continuation in
      firstBatchWaiters.append(continuation)
    }
  }

  func waitForFinalize() async {
    guard finalizeCount == 0 else { return }
    await withCheckedContinuation { continuation in
      finalizeWaiters.append(continuation)
    }
  }
}

private actor BlockingInferAPI: InferAPI {
  private let responseText: String
  private var continuation: CheckedContinuation<InferenceRecognizeOut, Never>?
  private var started = false
  private var startedWaiters: [CheckedContinuation<Void, Never>] = []
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
    let waiters = startedWaiters
    startedWaiters.removeAll()
    for waiter in waiters {
      waiter.resume()
    }
    return await withCheckedContinuation { continuation = $0 }
  }

  func waitUntilStarted() async {
    guard !started else { return }
    await withCheckedContinuation { continuation in
      startedWaiters.append(continuation)
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
  private var callWaiters: [CheckedContinuation<Void, Never>] = []

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
    let waiters = callWaiters
    callWaiters.removeAll()
    for waiter in waiters {
      waiter.resume()
    }
    throw failure
  }

  func waitUntilCalled() async {
    guard !wasCalled else { return }
    await withCheckedContinuation { continuation in
      callWaiters.append(continuation)
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
