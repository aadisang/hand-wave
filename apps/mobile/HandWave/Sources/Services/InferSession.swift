import Foundation

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

  init(client: InferAPI = InferClient()) {
    self.client = client
  }

  func start() async throws(InferenceFailure) {
    try await client.warmConnection()
  }

  func stop() async {
    epoch += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    pendingError = nil
    state = nil
    resetSegment()
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

    if moving {
      if ended { resetSegment() }
      ended = false
      moved = true
      idle = 0
    } else if moved {
      idle += 1
    }

    if ended { return nil }

    frames.append(frame)
    if frames.count > InferCfg.Decode.window {
      frames.removeFirst(frames.count - InferCfg.Decode.window)
    }
    seen += 1

    if idle >= InferCfg.Stream.idle {
      return try await finalizeSegment(reason: .idle)
    }

    if seen < InferCfg.Stream.min { return nil }
    if seen % InferCfg.Stream.stride != 0 || inFlight { return nil }

    startDecode(batch: frames, idleFrames: idle, motion: motion)
    return nil
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
    pendingEvent = response.displayPrediction.map {
      Event.partial(
        Self.prediction(from: $0, processingTimeMs: response.trace.decode?.latencyMs ?? 0)
      )
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
    guard moved, seen >= InferCfg.Stream.min else {
      resetLive()
      return .clear
    }

    lost += 1
    idle += 1
    if lost >= InferCfg.Stream.lost
      || idle >= InferCfg.Stream.idle
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
    ended = true
    epoch += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    state = nil
    resetSegment()

    guard let currentState else {
      return .clear
    }
    let response = try await client.recognize(
      frames: [],
      state: currentState,
      context: context,
      finalize: true
    )

    guard let prediction = response.displayPrediction, !prediction.label.isEmpty else {
      return .clear
    }
    return .finalized(Self.prediction(from: prediction, processingTimeMs: 0))
  }

  private func resetLive() {
    resetSegment()
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
