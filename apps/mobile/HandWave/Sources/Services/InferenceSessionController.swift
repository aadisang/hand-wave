import Foundation

actor InferenceSessionController {
  enum Event: Equatable, Sendable {
    case partial(PredictionOutput)
    case finalized(PredictionOutput)
  }

  struct PredictionOutput: Equatable, Sendable {
    let text: String
    let confidence: Double
    let processingTimeMs: Double
  }

  private struct Candidate {
    let rawText: String
    let confidence: Double
    let text: String
    let score: Double
  }

  private let client: InferenceClient
  private var sessionId: String?
  private var queuedFrames: [LandmarkFrame] = []
  private var framesSeen = 0
  private var inFlight = false
  private var lastFrame: LandmarkFrame?
  private var idleFrames = 0
  private var hasMoved = false
  private var endpointed = false
  private var generation = 0
  private var latestPrediction: PredictionOutput?
  private var bestPrediction: PredictionOutput?
  private var bestPredictionScore = -Double.infinity

  private let minDecodeFrames = 24
  private let strideFrames = 4
  private let idleFramesToFinalize = 14
  private let idleFramesToFreezePrediction = 6
  private let motionThreshold = 0.003

  init(client: InferenceClient = InferenceClient()) {
    self.client = client
  }

  func start() async throws {
    if sessionId == nil {
      sessionId = try await client.createSession()
    }
  }

  func stop() async {
    let id = sessionId
    sessionId = nil
    generation += 1
    resetLocalState()
    latestPrediction = nil
    bestPrediction = nil
    bestPredictionScore = -Double.infinity
    if let id {
      await client.deleteSession(sessionId: id)
    }
  }

  func ingest(_ frame: LandmarkFrame?) async throws -> Event? {
    guard let sessionId else { return nil }
    guard let frame else {
      if !endpointed {
        return try await finalizeSegment(sessionId: sessionId)
      }
      return nil
    }

    let motion = frameMotion(previous: lastFrame, current: frame)
    lastFrame = frame
    let moving = motion >= motionThreshold

    if moving {
      if endpointed { resetLocalState() }
      endpointed = false
      hasMoved = true
      idleFrames = 0
    } else if hasMoved {
      idleFrames += 1
    }

    if endpointed { return nil }

    queuedFrames.append(frame)
    framesSeen += 1

    if idleFrames >= idleFramesToFinalize {
      return try await finalizeSegment(sessionId: sessionId)
    }

    if framesSeen < minDecodeFrames { return nil }
    if framesSeen % strideFrames != 0 || inFlight { return nil }

    let frames = queuedFrames
    queuedFrames.removeAll(keepingCapacity: true)
    let requestGeneration = generation
    let idleAtRequest = idleFrames
    inFlight = true
    let started = ContinuousClock.now
    defer { inFlight = false }

    let response = try await client.appendFrames(sessionId: sessionId, frames: frames)
    guard requestGeneration == generation,
      idleAtRequest < idleFramesToFreezePrediction,
      let candidate = selectPredictionCandidate(response)
    else {
      return nil
    }

    let elapsed = started.duration(to: .now)
    let output = PredictionOutput(
      text: candidate.text,
      confidence: candidate.confidence,
      processingTimeMs: Double(elapsed.components.seconds) * 1_000
        + Double(elapsed.components.attoseconds) / 1e15
    )
    latestPrediction = output
    if candidate.score >= bestPredictionScore {
      bestPrediction = output
      bestPredictionScore = candidate.score
    }
    return .partial(output)
  }

  private func finalizeSegment(sessionId: String) async throws -> Event? {
    let finalPrediction = bestPrediction ?? latestPrediction
    endpointed = true
    generation += 1
    latestPrediction = nil
    bestPrediction = nil
    bestPredictionScore = -Double.infinity
    resetLocalState()
    _ = try await client.resetSession(sessionId: sessionId)

    guard let finalPrediction, !finalPrediction.text.isEmpty else { return nil }
    return .finalized(finalPrediction)
  }

  private func resetLocalState() {
    queuedFrames.removeAll(keepingCapacity: true)
    framesSeen = 0
    lastFrame = nil
    idleFrames = 0
    hasMoved = false
  }

  private func selectPredictionCandidate(_ response: StreamPredictionResponse) -> Candidate? {
    let inputs =
      [
        (response.partialText, response.prediction.confidence),
        (response.stableText, response.prediction.confidence * 0.9),
        (response.prediction.label, response.prediction.confidence),
      ] + response.alternatives.map { ($0.label, $0.confidence) }

    return inputs.reduce(nil) { best, input in
      let text = cleanPredictionText(input.0)
      guard !text.isEmpty else { return best }
      let candidate = Candidate(
        rawText: input.0,
        confidence: input.1,
        text: text,
        score: scorePredictionCandidate(
          rawText: input.0,
          text: text,
          confidence: input.1
        )
      )
      guard let best else { return candidate }
      return candidate.score > best.score ? candidate : best
    }
  }

  private func cleanPredictionText(_ text: String) -> String {
    let allowed = text.lowercased().map { character in
      character.isLetter || character.isNumber || character == " " ? character : " "
    }
    return String(allowed)
      .split(separator: " ")
      .joined(separator: " ")
  }

  private func scorePredictionCandidate(
    rawText: String,
    text: String,
    confidence: Double
  ) -> Double {
    let punctuationPenalty = rawText.filter {
      !$0.isLetter && !$0.isNumber && $0 != " "
    }.count
    let repeatedTailPenalty =
      text.count >= 2 && text.suffix(1) == text.dropLast().suffix(1) ? 0.25 : 0
    let shortFragmentPenalty = text.count <= 3 && text.contains(" ") ? 0.75 : 0
    let singleCharacterBonus = text.count == 1 ? 0.35 : 0
    return confidence * 4 + Double(min(text.count, 8)) * 0.03
      - Double(punctuationPenalty) * 0.5 - repeatedTailPenalty
      - shortFragmentPenalty + singleCharacterBonus
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
