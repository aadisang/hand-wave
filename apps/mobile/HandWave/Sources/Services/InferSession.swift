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
  private var sid: String?
  private var frames: [LandmarkFrame] = []
  private var seen = 0
  private var inFlight = false
  private var last: LandmarkFrame?
  private var idle = 0
  private var moved = false
  private var ended = false
  private var lost = 0
  private var gen = 0

  init(client: InferAPI = InferClient()) {
    self.client = client
  }

  func start() async throws {
    if sid == nil {
      sid = try await client.createSession()
    }
  }

  func stop() async {
    let id = sid
    sid = nil
    gen += 1
    resetSegment()
    arbiter.reset()
    if let id {
      await client.deleteSession(sessionId: id)
    }
  }

  func ingest(_ frame: LandmarkFrame?) async throws -> Event? {
    guard let sid else { return nil }
    guard let frame else {
      return try await acceptMissingFrame(sessionId: sid)
    }

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
    seen += 1

    if idle >= InferCfg.Stream.idle {
      return try await finalizeSegment(sessionId: sid, reason: .idle)
    }

    if seen < InferCfg.Stream.min { return nil }
    if seen % InferCfg.Stream.stride != 0 || inFlight { return nil }

    let batch = frames
    frames.removeAll(keepingCapacity: true)
    let requestGen = gen
    inFlight = true
    let started = ContinuousClock.now
    defer { inFlight = false }

    let response = try await client.appendFrames(sessionId: sid, frames: batch)
    guard requestGen == gen else { return nil }

    let elapsed = started.duration(to: .now)
    let update = arbiter.accept(
      response,
      context: Arbiter.DecodeContext(
        latencyMs: Double(elapsed.components.seconds) * 1_000
          + Double(elapsed.components.attoseconds) / 1e15,
        idleFrames: idle,
        motion: motion
      )
    )
    return update.displayPrediction.map(Event.partial)
  }

  private func acceptMissingFrame(sessionId: String) async throws -> Event? {
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
      return try await finalizeSegment(sessionId: sessionId, reason: .landmarkLost)
    }
    return nil
  }

  private func finalizeSegment(
    sessionId: String,
    reason: Arbiter.EndpointReason
  ) async throws -> Event? {
    let finalized = arbiter.finalize(
      context: Arbiter.FinalizeContext(
        endpointReason: reason,
        segmentFrames: seen
      )
    )
    ended = true
    gen += 1
    arbiter.reset()
    resetSegment()
    _ = try await client.resetSession(sessionId: sessionId)

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
