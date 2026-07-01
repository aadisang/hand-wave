import Foundation

private struct StreamTiming {
  private static let maxWireFrames = 512

  let maxFrames: Int
  let minFrames: Int
  let stride: Int
  let idleFrames: Int
  let lostFrames: Int

  init(frameRate: Double) {
    precondition(frameRate > 0)
    let scale = frameRate / Double(InferCfg.Stream.fps)
    maxFrames = min(Self.maxWireFrames, Self.scaled(InferCfg.Decode.window, by: scale))
    minFrames = Self.scaled(InferCfg.Stream.min, by: scale)
    stride = Self.scaled(InferCfg.Stream.stride, by: scale)
    idleFrames = Self.scaled(InferCfg.Stream.idle, by: scale)
    lostFrames = Self.scaled(InferCfg.Stream.lost, by: scale)
  }

  private static func scaled(_ value: Int, by scale: Double) -> Int {
    max(1, Int((Double(value) * scale).rounded(.up)))
  }
}

actor InferSession {
  enum Event: Equatable, Sendable {
    case clear
    case partial(Pred)
    case finalized(Pred)
  }

  struct Pred: Equatable, Sendable {
    let text: String
    let confidence: Double
    let processingTimeMs: Double
  }

  private let client: InferAPI
  private var state: InferenceRecognitionState?
  private var frames: [LandmarkFrame] = []
  private var seen = 0
  private var inFlight = false
  private var last: LandmarkFrame?
  private var idle = 0
  private var moved = false
  private var ended = false
  private var lost = 0
  private var epoch = 0
  private var requestId = 0
  private var pendingEvent: Event?
  private var pendingError: InferenceFailure?
  private var hasDisplayedPrediction = false
  private var timing = StreamTiming(frameRate: Double(InferCfg.Stream.fps))

  init(client: InferAPI = InferClient()) {
    self.client = client
  }

  func start() async throws(InferenceFailure) {
    try await client.warmConnection()
  }

  func setFrameRate(_ frameRate: Double) {
    timing = StreamTiming(frameRate: frameRate)
    resetLive()
  }

  func stop() async {
    epoch += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    pendingError = nil
    hasDisplayedPrediction = false
    state = nil
    resetSegment()
  }

  func resetAfterSpokenPartial() {
    epoch += 1
    requestId += 1
    inFlight = false
    pendingError = nil
    state = nil
    resetSegment()
    if hasDisplayedPrediction {
      hasDisplayedPrediction = false
      pendingEvent = .clear
    } else {
      pendingEvent = nil
    }
  }

  func ingest(_ frame: LandmarkFrame?) async throws(InferenceFailure) -> Event? {
    if let error = pendingError {
      pendingError = nil
      throw error
    }
    if let pending = takePendingEvent() {
      return pending
    }

    if let frame {
      return try await accept(frame)
    }
    return try await acceptMissingFrame()
  }

  private func accept(_ frame: LandmarkFrame) async throws(InferenceFailure) -> Event? {
    let motion = frameMotion(previous: last, current: frame)
    last = frame
    lost = 0
    let moving = motion >= InferCfg.Stream.motion
    var clearVisiblePrediction = false

    if moving {
      if ended {
        resetSegment()
        last = frame
        if hasDisplayedPrediction {
          hasDisplayedPrediction = false
          clearVisiblePrediction = true
        }
      }
      ended = false
      moved = true
      idle = 0
    } else if moved {
      idle += 1
    }

    if ended { return nil }

    frames.append(frame)
    if frames.count > timing.maxFrames {
      frames.removeFirst(frames.count - timing.maxFrames)
    }
    seen += 1

    if idle >= timing.idleFrames {
      return try await finalizeSegment(reason: .idle)
    }

    if seen < timing.minFrames { return clearVisiblePrediction ? .clear : nil }
    if seen % timing.stride != 0 || inFlight { return clearVisiblePrediction ? .clear : nil }

    startDecode(batch: frames, idleFrames: idle, motion: motion)
    return clearVisiblePrediction ? .clear : nil
  }

  private func startDecode(
    batch: [LandmarkFrame],
    idleFrames: Int,
    motion: Double
  ) {
    requestId += 1
    let id = requestId
    let requestEpoch = epoch
    let currentState = state
    let context = recognitionContext(idleFrames: idleFrames, motion: motion)
    inFlight = true

    Task { [client] in
      do {
        let response = try await client.recognize(
          frames: batch,
          state: currentState,
          context: context,
          finalize: false
        )
        self.finishDecode(
          response,
          id: id,
          epoch: requestEpoch
        )
      } catch let error as InferenceFailure {
        self.failDecode(error, id: id, epoch: requestEpoch)
      } catch {
        preconditionFailure("Unexpected inference error: \(error)")
      }
    }
  }

  private func finishDecode(
    _ response: InferenceRecognizeOut,
    id: Int,
    epoch requestEpoch: Int
  ) {
    guard id == requestId else { return }
    inFlight = false
    guard requestEpoch == epoch else { return }

    state = response.state
    if let prediction = response.displayPrediction {
      hasDisplayedPrediction = true
      pendingEvent = .partial(
        Self.prediction(from: prediction, processingTimeMs: response.trace.decode?.latencyMs ?? 0)
      )
    } else if hasDisplayedPrediction {
      hasDisplayedPrediction = false
      pendingEvent = .clear
    } else {
      pendingEvent = nil
    }
  }

  private func failDecode(_ error: InferenceFailure, id: Int, epoch requestEpoch: Int) {
    guard id == requestId else { return }
    inFlight = false
    guard requestEpoch == epoch else { return }
    pendingError = error
  }

  private func takePendingEvent() -> Event? {
    let event = pendingEvent
    pendingEvent = nil
    return event
  }

  private func acceptMissingFrame() async throws(InferenceFailure) -> Event? {
    guard !ended else { return nil }
    guard moved, seen >= timing.minFrames else {
      resetLive()
      return .clear
    }

    lost += 1
    idle += 1
    if lost >= timing.lostFrames
      || idle >= timing.idleFrames
    {
      if inFlight { return nil }
      return try await finalizeSegment(reason: .landmarkLost)
    }
    return nil
  }

  private func finalizeSegment(
    reason: InferenceEndpointReason
  ) async throws(InferenceFailure) -> Event? {
    let currentState = state
    let context = endpointContext(reason)
    let finalFrames = frames
    ended = true
    epoch += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    state = nil
    resetSegment()

    guard let currentState else {
      hasDisplayedPrediction = false
      return .clear
    }
    let response = try await client.recognize(
      frames: finalFrames,
      state: currentState,
      context: context,
      finalize: true
    )

    guard let prediction = response.displayPrediction, !prediction.label.isEmpty else {
      hasDisplayedPrediction = false
      return .clear
    }
    hasDisplayedPrediction = true
    return .finalized(Self.prediction(from: prediction, processingTimeMs: 0))
  }

  private func resetLive() {
    resetSegment()
    hasDisplayedPrediction = false
    state = nil
  }

  private func resetSegment() {
    frames.removeAll(keepingCapacity: true)
    seen = 0
    last = nil
    idle = 0
    moved = false
    lost = 0
  }

  private func frameMotion(previous: LandmarkFrame?, current: LandmarkFrame) -> Double {
    guard let previous else { return 0 }
    let count = min(21, previous.landmarks.count, current.landmarks.count)
    guard count > 0 else { return 0 }

    var total = 0.0
    for index in 0..<count {
      let a = previous.landmarks[index]
      let b = current.landmarks[index]
      total += abs(a.x - b.x) + abs(a.y - b.y)
    }
    return total / Double(count)
  }

  private func recognitionContext(idleFrames: Int, motion: Double) -> InferenceRecognitionContext {
    InferenceRecognitionContext(
      idleFrames: idleFrames,
      missingFrames: lost,
      segmentFrames: seen,
      motion: motion
    )
  }

  private func endpointContext(_ reason: InferenceEndpointReason) -> InferenceRecognitionContext {
    InferenceRecognitionContext(
      idleFrames: idle,
      missingFrames: lost,
      segmentFrames: seen,
      motion: 0,
      endpointReason: reason
    )
  }

  private static func prediction(
    from prediction: InferencePrediction,
    processingTimeMs: Double
  ) -> Pred {
    Pred(
      text: prediction.label,
      confidence: prediction.confidence,
      processingTimeMs: processingTimeMs
    )
  }
}
