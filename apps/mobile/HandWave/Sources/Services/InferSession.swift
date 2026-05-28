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
  private var arbiter = Arbiter()
  private var frames: [LandmarkFrame] = []
  private var seen = 0
  private var inFlight = false
  private var last: LandmarkFrame?
  private var idle = 0
  private var moved = false
  private var ended = false
  private var lost = 0
  private var gen = 0
  private var requestId = 0
  private var pendingEvent: Event?
  private var pendingError: Error?

  init(client: InferAPI = InferClient()) {
    self.client = client
  }

  func start() async throws {}

  func stop() async {
    gen += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    pendingError = nil
    resetSegment()
    arbiter.reset()
  }

  func ingest(_ frame: LandmarkFrame?) async throws -> Event? {
    if let error = pendingError {
      pendingError = nil
      throw error
    }
    let pending = takePendingEvent()

    let event: Event?
    if let frame {
      event = accept(frame)
    } else {
      event = acceptMissingFrame()
    }
    return event ?? pending
  }

  private func accept(_ frame: LandmarkFrame) -> Event? {
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
      return finalizeSegment(reason: .idle)
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
    let generation = gen
    inFlight = true
    let started = ContinuousClock.now

    Task { [client] in
      do {
        let response = try await client.predict(frames: batch)
        finishDecode(
          response,
          id: id,
          generation: generation,
          idleFrames: idleFrames,
          motion: motion,
          started: started
        )
      } catch {
        failDecode(error, id: id, generation: generation)
      }
    }
  }

  private func finishDecode(
    _ response: StreamPred,
    id: Int,
    generation: Int,
    idleFrames: Int,
    motion: Double,
    started: ContinuousClock.Instant
  ) {
    guard id == requestId else { return }
    inFlight = false
    guard generation == gen else { return }

    let elapsed = started.duration(to: .now)
    let update = arbiter.accept(
      response,
      context: Arbiter.DecodeContext(
        latencyMs: Double(elapsed.components.seconds) * 1_000
          + Double(elapsed.components.attoseconds) / 1e15,
        idleFrames: idleFrames,
        motion: motion
      )
    )
    pendingEvent = update.displayPrediction.map(Event.partial)
  }

  private func failDecode(_ error: Error, id: Int, generation: Int) {
    guard id == requestId else { return }
    inFlight = false
    guard generation == gen else { return }
    pendingError = error
  }

  private func takePendingEvent() -> Event? {
    let event = pendingEvent
    pendingEvent = nil
    return event
  }

  private func acceptMissingFrame() -> Event? {
    guard !ended else { return nil }
    guard moved, seen >= InferCfg.Stream.min else {
      resetLiveState()
      return .clear
    }

    lost += 1
    idle += 1
    if lost >= InferCfg.Stream.lost
      || idle >= InferCfg.Stream.idle
    {
      return finalizeSegment(reason: .landmarkLost)
    }
    return nil
  }

  private func finalizeSegment(reason: Arbiter.EndpointReason) -> Event? {
    let finalized = arbiter.finalize(
      context: Arbiter.FinalizeContext(
        endpointReason: reason,
        segmentFrames: seen
      )
    )
    ended = true
    gen += 1
    requestId += 1
    inFlight = false
    pendingEvent = nil
    arbiter.reset()
    resetSegment()

    guard let pred = finalized.displayPrediction, !pred.text.isEmpty else {
      return .clear
    }
    return .finalized(pred)
  }

  private func resetLiveState() {
    resetSegment()
    arbiter.reset()
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
}
