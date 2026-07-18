import Foundation

private struct StreamTiming: Sendable {
  let sampleIntervalMs: Double
  let minimumDurationMs: Double
  let decodeIntervalMs: Double
  let idleDurationMs: Double
  let lostDurationMs: Double
  let windowDurationMs: Double

  init() {
    let frameDuration = 1_000.0 / Double(InferCfg.Stream.fps)
    sampleIntervalMs = frameDuration
    minimumDurationMs = Double(InferCfg.Stream.min) * frameDuration
    decodeIntervalMs = Double(InferCfg.Stream.stride) * frameDuration
    idleDurationMs = Double(InferCfg.Stream.idle) * frameDuration
    lostDurationMs = Double(InferCfg.Stream.lost) * frameDuration
    windowDurationMs = Double(InferCfg.Decode.window) * frameDuration
  }

  func frameCount(for durationMs: Double) -> Int {
    max(0, Int((durationMs / sampleIntervalMs).rounded()))
  }
}

actor InferSession {
  typealias EventHandler = @Sendable (RecognitionEvent) async -> Void

  private struct Endpoint: Sendable {
    let frames: [LandmarkFrame]
    let context: InferenceRecognitionContext
  }

  private let client: InferAPI
  private let timing = StreamTiming()
  private var eventHandler: EventHandler?
  private var recognitionState: InferenceRecognitionState?
  private var frames: [LandmarkFrame] = []
  private var lastObservedFrame: LandmarkFrame?
  private var segmentStartedAt: Int?
  private var lastMotionAt: Int?
  private var missingSince: Int?
  private var nextSampleAt: Double?
  private var lastDecodeAt: Int?
  private var sampledFrames = 0
  private var hasMoved = false
  private var hasEnded = false
  private var hasDisplayedPrediction = false
  private var inFlight = false
  private var pendingEndpoint: Endpoint?
  private var pendingEvent: RecognitionEvent?
  private var pendingError: InferenceFailure?
  private var deferredFrames: [LandmarkFrame] = []
  private var endingFrame: LandmarkFrame?
  private var epoch = 0
  private var requestID = 0
  private var requestTask: Task<Void, Never>?

  init(client: InferAPI = InferClient()) {
    self.client = client
  }

  func setEventHandler(_ handler: @escaping EventHandler) {
    eventHandler = handler
  }

  func start() async throws(InferenceFailure) {
    try await client.warmConnection()
  }

  func stop() async {
    invalidateRequests()
    eventHandler = nil
    pendingEvent = nil
    pendingError = nil
    hasDisplayedPrediction = false
    recognitionState = nil
    resetSegment()
    await client.resetStream()
  }

  func ingest(
    _ frame: LandmarkFrame?,
    at timestampMs: Int
  ) async throws(InferenceFailure) -> RecognitionEvent? {
    if let pendingEvent {
      self.pendingEvent = nil
      return pendingEvent
    }
    if let pendingError {
      self.pendingError = nil
      throw pendingError
    }

    if let frame {
      return accept(frame, at: timestampMs)
    }
    return acceptMissingFrame(at: timestampMs)
  }

  private func accept(_ frame: LandmarkFrame, at timestampMs: Int) -> RecognitionEvent? {
    if hasEnded {
      deferredFrames.append(frame)
      if deferredFrames.count > InferCfg.Decode.window {
        deferredFrames.removeFirst(deferredFrames.count - InferCfg.Decode.window)
      }
      return nil
    }

    let previousFrame = lastObservedFrame
    let motion = frameMotion(previous: previousFrame, current: frame)
    lastObservedFrame = frame
    missingSince = nil

    if motion >= InferCfg.Stream.motion {
      hasMoved = true
      lastMotionAt = timestampMs
    }

    guard !hasEnded else { return nil }
    segmentStartedAt = segmentStartedAt ?? timestampMs
    sample(frame, after: previousFrame, at: timestampMs)

    if hasMoved, duration(since: lastMotionAt, at: timestampMs) >= timing.idleDurationMs {
      requestFinalization(reason: .idle, at: timestampMs)
      return nil
    }

    guard duration(since: segmentStartedAt, at: timestampMs) >= timing.minimumDurationMs else {
      return nil
    }
    guard sampledFrames >= InferCfg.Stream.min else { return nil }
    guard !inFlight else { return nil }
    if let lastDecodeAt,
      duration(since: lastDecodeAt, at: timestampMs) < timing.decodeIntervalMs
    {
      return nil
    }

    startDecode(at: timestampMs, motion: motion)
    return nil
  }

  private func acceptMissingFrame(at timestampMs: Int) -> RecognitionEvent? {
    guard !hasEnded else { return nil }
    guard hasMoved, segmentStartedAt != nil else {
      resetSegment()
      return .clear
    }

    missingSince = missingSince ?? timestampMs
    let missingDuration = duration(since: missingSince, at: timestampMs)
    let idleDuration = duration(since: lastMotionAt, at: timestampMs)
    if missingDuration >= timing.lostDurationMs || idleDuration >= timing.idleDurationMs {
      requestFinalization(reason: .landmarkLost, at: timestampMs)
    }
    return nil
  }

  private func sample(
    _ frame: LandmarkFrame,
    after previous: LandmarkFrame?,
    at timestampMs: Int
  ) {
    if nextSampleAt == nil {
      frames.append(frame)
      sampledFrames += 1
      nextSampleAt = Double(timestampMs) + timing.sampleIntervalMs
      return
    }
    guard let sampleAt = nextSampleAt, Double(timestampMs) >= sampleAt else { return }

    // Advance a fixed 24 FPS grid instead of coupling model time to camera or detector FPS.
    var next = sampleAt
    while next <= Double(timestampMs) {
      frames.append(interpolate(from: previous, to: frame, at: next))
      sampledFrames += 1
      next += timing.sampleIntervalMs
    }
    nextSampleAt = next

    let cutoff = Double(timestampMs) - timing.windowDurationMs
    if let firstValid = frames.firstIndex(where: { Double($0.timestampMs) >= cutoff }),
      firstValid > 0
    {
      frames.removeFirst(firstValid)
    }
  }

  private func startDecode(at timestampMs: Int, motion: Double) {
    requestID &+= 1
    let id = requestID
    let requestEpoch = epoch
    let batch = frames
    let state = recognitionState
    let context = recognitionContext(at: timestampMs, motion: motion)
    inFlight = true
    lastDecodeAt = timestampMs
    AppLog.inference.debug(
      "Sending recognition batch frames=\(batch.count) sampled=\(self.sampledFrames)"
    )

    requestTask = Task { [client] in
      do {
        let response = try await client.recognize(
          frames: batch,
          state: state,
          context: context,
          finalize: false
        )
        guard !Task.isCancelled else { return }
        await self.finishDecode(response, id: id, epoch: requestEpoch)
      } catch let failure as InferenceFailure {
        self.fail(failure, id: id, epoch: requestEpoch)
      } catch {
        self.fail(.unexpected(error.localizedDescription), id: id, epoch: requestEpoch)
      }
    }
  }

  private func finishDecode(
    _ response: InferenceRecognizeOut,
    id: Int,
    epoch requestEpoch: Int
  ) async {
    guard id == requestID, requestEpoch == epoch else { return }
    inFlight = false
    requestTask = nil
    recognitionState = response.state
    await deliver(event(from: response))

    if let endpoint = pendingEndpoint {
      pendingEndpoint = nil
      startFinalization(endpoint)
    }
  }

  private func requestFinalization(reason: InferenceEndpointReason, at timestampMs: Int) {
    guard !hasEnded else { return }
    hasEnded = true
    endingFrame = lastObservedFrame
    let endpoint = Endpoint(
      frames: frames,
      context: endpointContext(reason, at: timestampMs)
    )
    guard !inFlight else {
      pendingEndpoint = endpoint
      return
    }
    startFinalization(endpoint)
  }

  private func startFinalization(_ endpoint: Endpoint) {
    guard let state = recognitionState else {
      hasDisplayedPrediction = false
      resetSegment()
      queue(.clear)
      return
    }

    requestID &+= 1
    let id = requestID
    let requestEpoch = epoch
    inFlight = true

    requestTask = Task { [client] in
      do {
        let response = try await client.recognize(
          frames: endpoint.frames,
          state: state,
          context: endpoint.context,
          finalize: true
        )
        guard !Task.isCancelled else { return }
        await self.finishFinalization(response, id: id, epoch: requestEpoch)
      } catch let failure as InferenceFailure {
        self.fail(failure, id: id, epoch: requestEpoch)
      } catch {
        self.fail(.unexpected(error.localizedDescription), id: id, epoch: requestEpoch)
      }
    }
  }

  private func finishFinalization(
    _ response: InferenceRecognizeOut,
    id: Int,
    epoch requestEpoch: Int
  ) async {
    guard id == requestID, requestEpoch == epoch else { return }
    inFlight = false
    requestTask = nil
    recognitionState = nil

    let event: RecognitionEvent
    if let prediction = response.displayPrediction, !prediction.label.isEmpty {
      hasDisplayedPrediction = true
      event = .finalized(Self.prediction(from: prediction, response: response))
    } else {
      hasDisplayedPrediction = false
      event = .clear
    }
    await deliver(event)
    let deferredFrames = takeDeferredFrames()
    let endpointFrame = endingFrame
    resetSegment()
    replay(deferredFrames, after: endpointFrame)
  }

  private func fail(_ failure: InferenceFailure, id: Int, epoch requestEpoch: Int) {
    guard id == requestID, requestEpoch == epoch else { return }
    inFlight = false
    requestTask = nil
    pendingError = failure
    if hasEnded {
      let deferredFrames = takeDeferredFrames()
      let endpointFrame = endingFrame
      pendingEndpoint = nil
      recognitionState = nil
      hasDisplayedPrediction = false
      resetSegment()
      queue(.clear)
      replay(deferredFrames, after: endpointFrame)
    }
  }

  private func event(from response: InferenceRecognizeOut) -> RecognitionEvent? {
    if let prediction = response.displayPrediction {
      hasDisplayedPrediction = true
      return .partial(Self.prediction(from: prediction, response: response))
    }
    guard hasDisplayedPrediction else { return nil }
    hasDisplayedPrediction = false
    return .clear
  }

  private func deliver(_ event: RecognitionEvent?) async {
    guard let event else { return }
    if let eventHandler {
      await eventHandler(event)
    } else {
      pendingEvent = event
    }
  }

  private func queue(_ event: RecognitionEvent?) {
    guard let event else { return }
    pendingEvent = event
  }

  private func beginNextSegment() {
    invalidateRequests()
    recognitionState = nil
    let shouldClear = hasDisplayedPrediction
    hasDisplayedPrediction = false
    resetSegment()
    queue(shouldClear ? .clear : nil)
  }

  private func invalidateRequests() {
    epoch &+= 1
    requestID &+= 1
    requestTask?.cancel()
    requestTask = nil
    inFlight = false
    pendingEndpoint = nil
    deferredFrames.removeAll(keepingCapacity: true)
    endingFrame = nil
  }

  private func resetSegment(keepingEnded: Bool = false) {
    frames.removeAll(keepingCapacity: true)
    lastObservedFrame = nil
    segmentStartedAt = nil
    lastMotionAt = nil
    missingSince = nil
    nextSampleAt = nil
    lastDecodeAt = nil
    sampledFrames = 0
    hasMoved = false
    hasEnded = keepingEnded
    if !keepingEnded {
      endingFrame = nil
    }
  }

  private func takeDeferredFrames() -> [LandmarkFrame] {
    let frames = deferredFrames
    deferredFrames.removeAll(keepingCapacity: true)
    return frames
  }

  private func replay(_ frames: [LandmarkFrame], after endingFrame: LandmarkFrame?) {
    let startIndex: Int
    let movementIndex: Int?
    if let endingFrame {
      guard
        let detectedMovement = frames.firstIndex(where: {
          frameMotion(previous: endingFrame, current: $0) >= InferCfg.Stream.motion
        })
      else {
        return
      }
      movementIndex = detectedMovement
      startIndex = max(0, detectedMovement - 1)
    } else {
      movementIndex = nil
      startIndex = 0
    }

    for index in startIndex..<frames.count {
      let frame = frames[index]
      if index == movementIndex {
        hasMoved = true
        lastMotionAt = frame.timestampMs
      }
      _ = accept(frame, at: frame.timestampMs)
    }
  }

  private func recognitionContext(
    at timestampMs: Int, motion: Double
  ) -> InferenceRecognitionContext {
    InferenceRecognitionContext(
      idleFrames: timing.frameCount(for: duration(since: lastMotionAt, at: timestampMs)),
      missingFrames: timing.frameCount(for: duration(since: missingSince, at: timestampMs)),
      segmentFrames: sampledFrames,
      motion: motion
    )
  }

  private func endpointContext(
    _ reason: InferenceEndpointReason,
    at timestampMs: Int
  ) -> InferenceRecognitionContext {
    InferenceRecognitionContext(
      idleFrames: timing.frameCount(for: duration(since: lastMotionAt, at: timestampMs)),
      missingFrames: timing.frameCount(for: duration(since: missingSince, at: timestampMs)),
      segmentFrames: sampledFrames,
      motion: 0,
      endpointReason: reason
    )
  }

  private func duration(since start: Int?, at timestampMs: Int) -> Double {
    guard let start else { return 0 }
    return Double(max(0, timestampMs - start))
  }

  private func interpolate(
    from previous: LandmarkFrame?,
    to current: LandmarkFrame,
    at timestamp: Double
  ) -> LandmarkFrame {
    guard let previous, previous.landmarks.count == current.landmarks.count else {
      return current
    }
    let span = Double(current.timestampMs - previous.timestampMs)
    guard span > 0 else { return current }
    let progress = min(1, max(0, (timestamp - Double(previous.timestampMs)) / span))
    let landmarks = zip(previous.landmarks, current.landmarks).map { start, end in
      LandmarkPoint(
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        z: (start.z ?? 0) + ((end.z ?? 0) - (start.z ?? 0)) * progress
      )
    }
    return LandmarkFrame(landmarks: landmarks, timestampMs: Int(timestamp.rounded()))
  }

  private func frameMotion(previous: LandmarkFrame?, current: LandmarkFrame) -> Double {
    guard let previous else { return 0 }
    let pairs = zip(previous.landmarks.prefix(21), current.landmarks.prefix(21))
    let differences = pairs.map { abs($0.x - $1.x) + abs($0.y - $1.y) }
    guard !differences.isEmpty else { return 0 }
    return differences.reduce(0, +) / Double(differences.count)
  }

  private static func prediction(
    from prediction: InferencePrediction,
    response: InferenceRecognizeOut
  ) -> Prediction {
    Prediction(
      text: prediction.label,
      confidence: prediction.confidence,
      processingTimeMs: response.trace.decode?.latencyMs ?? 0
    )
  }
}
