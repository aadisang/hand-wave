import Foundation

struct Arbiter: Sendable {
  struct DecodeContext: Equatable, Sendable {
    let latencyMs: Double
    let idleFrames: Int
    let motion: Double
  }

  struct FinalizeContext: Equatable, Sendable {
    let endpointReason: EndpointReason
    let segmentFrames: Int
  }

  enum EndpointReason: Equatable, Sendable {
    case idle
    case landmarkLost
  }

  struct Update: Equatable, Sendable {
    let displayPrediction: InferSession.Pred?
  }

  struct Finalized: Equatable, Sendable {
    let displayPrediction: InferSession.Pred?
    let committed: Bool
  }

  private enum CandidateSource: Equatable, Sendable {
    case partial
    case raw
    case alternative
  }

  private struct CandidateInput: Equatable, Sendable {
    let source: CandidateSource
    let rawText: String
    let confidence: Double
    let lmScore: Double?
    let modelAgrees: Bool
  }

  private struct Candidate: Equatable, Sendable {
    let source: CandidateSource
    let rawText: String
    let text: String
    let confidence: Double
    let lmScore: Double?
    let modelAgrees: Bool
    let score: Double
  }

  private struct ScoredPrediction: Equatable, Sendable {
    let prediction: InferSession.Pred
    let score: Double
    let source: CandidateSource
    let lmScore: Double?
    let modelAgrees: Bool
    let streak: Int
  }

  private enum TextKind: Sendable {
    case letter
    case short
    case word
    case phrase
    case long
  }

  private struct Threshold: Sendable {
    let instant: Double
    let seen: Int
    let streak: Int
    let confidence: Double
  }

  private struct DecisionState: Sendable {
    let context: DecodeContext
    let misses: Int
    let seenCount: Int
    let score: Double
    let streak: Int
  }

  private var display: ScoredPrediction?
  private var finalCandidate: ScoredPrediction?
  private var selectedText = ""
  private var selectedStreak = 0
  private var displayMisses = 0
  private var counts: [String: Int] = [:]

  mutating func reset() {
    display = nil
    finalCandidate = nil
    selectedText = ""
    selectedStreak = 0
    displayMisses = 0
    counts.removeAll(keepingCapacity: true)
  }

  mutating func accept(
    _ response: StreamPred,
    context: DecodeContext
  ) -> Update {
    let candidate = selectCandidate(
      from: response,
      previousDisplayText: display?.prediction.text ?? ""
    )

    if let candidate {
      accept(candidate, context: context)
    }

    return Update(displayPrediction: display?.prediction)
  }

  mutating func finalize(context: FinalizeContext) -> Finalized {
    let selected = pickFinalPred(display: display, final: finalCandidate)
    let prediction = selected?.prediction
    let seenCount = prediction.map { counts[$0.text] ?? 0 } ?? 0
    let committed = selected.map { shouldCommit($0, seenCount: seenCount) } ?? false

    return Finalized(
      displayPrediction: committed ? prediction : nil,
      committed: committed
    )
  }

  private mutating func accept(_ candidate: Candidate, context: DecodeContext) {
    let seenCount = (counts[candidate.text] ?? 0) + 1
    let streak = streak(for: candidate.text)
    let score = candidate.score + Double(min(seenCount, 4)) * 0.35
    let prediction = InferSession.Pred(
      text: format(candidate.text),
      confidence: candidate.confidence,
      processingTimeMs: context.latencyMs
    )
    let next = ScoredPrediction(
      prediction: prediction,
      score: score,
      source: candidate.source,
      lmScore: candidate.lmScore,
      modelAgrees: candidate.modelAgrees,
      streak: streak
    )

    counts[candidate.text] = seenCount
    finalCandidate = preferredFinal(current: finalCandidate, next: next)

    if let current = display, current.prediction.text == candidate.text {
      display = mergeSame(current: current, next: next)
      displayMisses = 0
      return
    }

    let misses = display == nil ? 0 : displayMisses + 1
    if shouldDisplay(
      next,
      replacing: display,
      state: DecisionState(
        context: context,
        misses: misses,
        seenCount: seenCount,
        score: score,
        streak: streak
      )
    ) {
      display = next
      displayMisses = 0
    } else {
      displayMisses = misses
    }
  }

  private mutating func streak(for text: String) -> Int {
    selectedStreak = selectedText == text ? selectedStreak + 1 : 1
    selectedText = text
    return selectedStreak
  }
}

extension Arbiter {
  private func selectCandidate(
    from response: StreamPred,
    previousDisplayText: String
  ) -> Candidate? {
    let rawLabel = response.prediction.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let raw = clean(rawLabel)
    let greedy = clean(response.greedyText)
    let inputs =
      [
        input(
          source: .partial,
          rawText: response.partialText,
          prediction: response.prediction,
          modelAgrees: clean(response.partialText) == greedy
        ),
        input(
          source: .raw,
          rawText: rawLabel,
          prediction: response.prediction,
          modelAgrees: raw == greedy
        ),
      ]
      + response.alternatives.map {
        CandidateInput(
          source: .alternative,
          rawText: $0.label.trimmingCharacters(in: .whitespacesAndNewlines),
          confidence: $0.confidence,
          lmScore: $0.lmScore,
          modelAgrees: false
        )
      }

    return inputs.reduce(nil) { best, input in
      let text = clean(input.rawText)
      guard !text.isEmpty else { return best }
      guard !badAltTail(source: input.source, text: text, raw: raw) else {
        return best
      }

      let candidate = Candidate(
        source: input.source,
        rawText: input.rawText,
        text: text,
        confidence: input.confidence,
        lmScore: input.lmScore,
        modelAgrees: input.modelAgrees,
        score: score(input, text: text, previous: previousDisplayText, raw: raw)
      )

      guard let best else { return candidate }
      return candidate.score > best.score ? candidate : best
    }
  }

  private func input(
    source: CandidateSource,
    rawText: String,
    prediction: Prediction,
    modelAgrees: Bool
  ) -> CandidateInput {
    CandidateInput(
      source: source,
      rawText: rawText,
      confidence: prediction.confidence,
      lmScore: prediction.lmScore,
      modelAgrees: modelAgrees
    )
  }

  private func shouldDisplay(
    _ next: ScoredPrediction,
    replacing display: ScoredPrediction?,
    state: DecisionState
  ) -> Bool {
    guard let display else {
      return passes(
        displayThreshold(for: kind(next.prediction.text)), candidate: next, state: state)
    }

    let current = display.prediction.text
    let candidate = next.prediction.text
    if shouldKeep(current: current, candidate: candidate) { return false }
    if singleTail(current: current, candidate: candidate) {
      return acceptsTail(next, display: display, state: state)
    }
    if acceptsFix(next, display: display, state: state) { return true }
    if acceptsRawExtension(next, display: display, state: state) { return true }
    if acceptsRaw(next, display: display) { return true }
    if acceptsRepeat(next, display: display, state: state) { return true }
    if acceptsExtend(next, display: display, state: state) { return true }
    if acceptsPrefix(next, display: display, state: state) { return true }
    if acceptsSimilar(next, display: display, state: state) { return true }
    return state.score >= display.score + 0.25
  }

  private func shouldCommit(_ candidate: ScoredPrediction, seenCount: Int) -> Bool {
    let prediction = candidate.prediction
    let weakLanguage =
      compact(prediction.text).count >= 7
      && (candidate.lmScore ?? 0) <= -1.2

    if weakLanguage {
      return prediction.confidence >= 0.9
        || (seenCount >= 5 && candidate.streak >= 3 && prediction.confidence >= 0.75)
    }

    return passes(
      commitThreshold(for: kind(prediction.text)),
      candidate: candidate,
      state: DecisionState(
        context: DecodeContext(latencyMs: 0, idleFrames: 0, motion: 0),
        misses: 0,
        seenCount: seenCount,
        score: candidate.score,
        streak: candidate.streak
      )
    )
  }

  private func passes(
    _ threshold: Threshold,
    candidate: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    candidate.prediction.confidence >= threshold.instant
      || (state.seenCount >= threshold.seen
        && state.streak >= threshold.streak
        && candidate.prediction.confidence >= threshold.confidence)
  }
}

extension Arbiter {
  private func preferredFinal(
    current: ScoredPrediction?,
    next: ScoredPrediction
  ) -> ScoredPrediction? {
    guard isReliableFinal(next) else { return current }
    guard let current else { return next }
    if next.prediction.text == current.prediction.text {
      return next.prediction.confidence > current.prediction.confidence ? next : current
    }
    if shortFinish(current: current.prediction.text, candidate: next.prediction.text) {
      return next.prediction.confidence >= 0.45 && next.score >= current.score - 0.5
        ? next
        : current
    }
    return next.prediction.confidence >= current.prediction.confidence + 0.12
      && next.score >= current.score - 0.5
      ? next
      : current
  }

  private func pickFinalPred(
    display: ScoredPrediction?,
    final: ScoredPrediction?
  ) -> ScoredPrediction? {
    guard let display else { return final }
    guard let final else { return display }
    if display.prediction.text == final.prediction.text {
      return final.prediction.confidence > display.prediction.confidence ? final : display
    }
    if shortFinish(current: display.prediction.text, candidate: final.prediction.text) {
      return final.score >= display.score - 0.5 ? final : display
    }
    return (display.prediction.confidence < 0.2 && final.prediction.confidence >= 0.45)
      || (final.prediction.confidence >= display.prediction.confidence + 0.25
        && final.score >= display.score)
      ? final
      : display
  }

  private func isReliableFinal(_ next: ScoredPrediction) -> Bool {
    next.source == .raw
      && next.modelAgrees
      && (next.lmScore == nil || next.lmScore! >= -0.3)
      && next.prediction.confidence >= finalConfidence(for: kind(next.prediction.text))
  }

  private func mergeSame(
    current: ScoredPrediction,
    next: ScoredPrediction
  ) -> ScoredPrediction {
    ScoredPrediction(
      prediction: InferSession.Pred(
        text: next.prediction.text,
        confidence: max(current.prediction.confidence, next.prediction.confidence),
        processingTimeMs: next.prediction.processingTimeMs
      ),
      score: max(current.score, next.score),
      source: next.source,
      lmScore: max(current.lmScore, next.lmScore),
      modelAgrees: current.modelAgrees || next.modelAgrees,
      streak: max(current.streak, next.streak)
    )
  }
}

extension Arbiter {
  private func score(
    _ candidate: CandidateInput,
    text: String,
    previous: String,
    raw: String
  ) -> Double {
    var value = candidate.confidence * 2
    value += languageValue(candidate)
    value += Double(min(text.count, 14)) * 0.08

    if candidate.source == .raw { value += 0.75 }
    if extendsPreviousText(candidate, text: text, previous: previous) { value += 1.1 }
    if repairsShortTail(text: text, previous: previous) { value += 0.65 }
    if text.range(of: #"^[a-z0-9]$"#, options: .regularExpression) != nil {
      value += 0.35
    }

    value -= punctPenalty(candidate.rawText)
    if candidate.source == .alternative { value -= 0.8 }
    if altExtendsKnown(candidate, text: text, raw: raw, previous: previous) {
      value -= 1.8
    }
    if repeatedTail(text) { value -= 0.25 }
    if text.count <= 3 && text.contains(" ") { value -= 0.75 }
    if previous.count >= 4 && prefixLen(text, previous) < 3 { value -= 2.5 }
    return value
  }

  private func languageValue(_ candidate: CandidateInput) -> Double {
    min(max(candidate.lmScore ?? 0, -2.5), 3.5) * 0.45
  }

  private func punctPenalty(_ text: String) -> Double {
    Double(text.filter { !$0.isLetter && !$0.isNumber && $0 != " " }.count) * 0.5
  }

  private func extendsPreviousText(
    _ candidate: CandidateInput,
    text: String,
    previous: String
  ) -> Bool {
    candidate.source == .raw && previous.count >= 3 && text.hasPrefix(previous)
  }

  private func repairsShortTail(text: String, previous: String) -> Bool {
    text.count >= 4 && previous.hasPrefix(text) && previous.count - text.count <= 2
  }

  private func altExtendsKnown(
    _ candidate: CandidateInput,
    text: String,
    raw: String,
    previous: String
  ) -> Bool {
    candidate.source == .alternative
      && ((raw.count >= 3 && text.hasPrefix(raw))
        || (previous.count >= 3 && text.hasPrefix(previous)))
  }
}

extension Arbiter {
  private func displayThreshold(for kind: TextKind) -> Threshold {
    switch kind {
    case .letter: Threshold(instant: 0.12, seen: 3, streak: 1, confidence: 0.05)
    case .short: Threshold(instant: 0.18, seen: 1, streak: 3, confidence: 0.1)
    case .phrase: Threshold(instant: 0.2, seen: 1, streak: 3, confidence: 0.14)
    case .long: Threshold(instant: 0.22, seen: 1, streak: 2, confidence: 0.16)
    case .word: Threshold(instant: 0.18, seen: 1, streak: 2, confidence: 0.12)
    }
  }

  private func commitThreshold(for kind: TextKind) -> Threshold {
    switch kind {
    case .letter: Threshold(instant: 0.5, seen: 4, streak: 2, confidence: 0.22)
    case .short: Threshold(instant: 0.65, seen: 3, streak: 2, confidence: 0.28)
    case .phrase: Threshold(instant: 0.75, seen: 3, streak: 1, confidence: 0.29)
    case .long: Threshold(instant: 0.75, seen: 1, streak: 1, confidence: 0.32)
    case .word: Threshold(instant: 0.75, seen: 2, streak: 1, confidence: 0.28)
    }
  }

  private func finalConfidence(for kind: TextKind) -> Double {
    switch kind {
    case .letter: 0.3
    case .short: 0.55
    case .phrase, .long, .word: 0.45
    }
  }

  private func kind(_ text: String) -> TextKind {
    let cleaned = clean(text)
    let length = compact(cleaned).count
    if length == 1 { return .letter }
    if length <= 3 { return .short }
    if cleaned.contains(" ") { return .phrase }
    if length >= 7 { return .long }
    return .word
  }
}

extension Arbiter {
  private func acceptsTail(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    let idlePenalty = state.context.idleFrames > 0 ? 1.25 : 0.5
    let languageAllowsTail =
      next.lmScore == nil
      || next.lmScore! >= -0.25
      || display.prediction.confidence < 0.2

    return next.source == .raw
      && next.modelAgrees
      && state.seenCount >= 2
      && state.streak >= 2
      && next.prediction.confidence >= 0.45
      && languageAllowsTail
      && state.score >= display.score - idlePenalty
  }

  private func acceptsFix(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    let current = display.prediction.text
    let candidate = next.prediction.text
    return candidate.count >= current.count + 4
      && prefixLen(candidate, current) >= 2
      && state.score >= display.score - 3
  }

  private func acceptsRawExtension(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    let current = display.prediction.text
    let candidate = next.prediction.text
    return next.source == .raw
      && candidate.hasPrefix(current)
      && candidate.count >= current.count + 3
      && next.prediction.confidence >= 0.25
      && state.score >= display.score - 3.5
  }

  private func acceptsRaw(
    _ next: ScoredPrediction,
    display: ScoredPrediction
  ) -> Bool {
    next.source == .raw
      && next.prediction.text.count >= 4
      && compact(next.prediction.text).count >= compact(display.prediction.text).count
      && next.prediction.confidence >= display.prediction.confidence + 0.08
  }

  private func acceptsRepeat(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    next.source == .raw
      && state.streak >= 2
      && state.misses >= 3
      && next.prediction.text.count >= 3
      && state.score >= display.score - 4
  }

  private func acceptsExtend(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    next.prediction.text.hasPrefix(display.prediction.text)
      && state.score >= display.score - 1.2
  }

  private func acceptsPrefix(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    let current = display.prediction.text
    let candidate = next.prediction.text
    return current.hasPrefix(candidate)
      && current.count - candidate.count <= 2
      && state.seenCount >= 2
      && state.score >= display.score - 1
  }

  private func acceptsSimilar(
    _ next: ScoredPrediction,
    display: ScoredPrediction,
    state: DecisionState
  ) -> Bool {
    let current = display.prediction.text
    let candidate = next.prediction.text
    return prefixLen(candidate, current) >= 4
      && abs(candidate.count - current.count) <= 3
      && state.score >= display.score - 0.8
  }
}

extension Arbiter {
  private func clean(_ text: String) -> String {
    String(
      text
        .lowercased()
        .map { $0.isLetter || $0.isNumber || $0 == " " ? $0 : " " }
        .split(separator: " ")
        .joined(separator: " ")
    )
  }

  private func compact(_ text: String) -> String {
    clean(text).replacingOccurrences(of: " ", with: "")
  }

  private func format(_ text: String) -> String {
    clean(text)
  }

  private func badAltTail(
    source: CandidateSource,
    text: String,
    raw: String
  ) -> Bool {
    let extra = text.count - raw.count
    return source == .alternative && !raw.isEmpty && text.hasPrefix(raw) && extra > 0 && extra <= 2
  }

  private func shouldKeep(current: String, candidate: String) -> Bool {
    isSuffixWindow(current: current, candidate: candidate)
      || isSpacedVariant(current: current, candidate: candidate)
  }

  private func isSuffixWindow(current: String, candidate: String) -> Bool {
    let currentCompact = compact(current)
    let candidateCompact = compact(candidate)
    return currentCompact.count >= 10
      && candidateCompact.count >= 4
      && currentCompact.hasSuffix(candidateCompact)
      && currentCompact.count - candidateCompact.count >= 3
  }

  private func isSpacedVariant(current: String, candidate: String) -> Bool {
    !current.contains(" ")
      && candidate.contains(" ")
      && nearEdit(compact(current), compact(candidate))
  }

  private func singleTail(current: String, candidate: String) -> Bool {
    current.count >= 4 && candidate.hasPrefix(current) && candidate.count == current.count + 1
  }

  private func shortFinish(current: String, candidate: String) -> Bool {
    let currentCompact = compact(current)
    let candidateCompact = compact(candidate)
    let delta = candidateCompact.count - currentCompact.count
    return currentCompact.count >= 3
      && candidateCompact.hasPrefix(currentCompact)
      && delta > 0
      && delta <= 2
  }

  private func repeatedTail(_ text: String) -> Bool {
    guard let last = text.last, text.dropLast().last == last else { return false }
    return true
  }

  private func nearEdit(_ a: String, _ b: String) -> Bool {
    if abs(a.count - b.count) > 1 { return false }

    let left = Array(a)
    let right = Array(b)
    var edits = 0
    var i = 0
    var j = 0

    while i < left.count && j < right.count {
      if left[i] == right[j] {
        i += 1
        j += 1
      } else {
        edits += 1
        if edits > 1 { return false }
        if left.count > right.count {
          i += 1
        } else if right.count > left.count {
          j += 1
        } else {
          i += 1
          j += 1
        }
      }
    }

    if i < left.count || j < right.count { edits += 1 }
    return edits <= 1
  }

  private func prefixLen(_ a: String, _ b: String) -> Int {
    var count = 0
    for (left, right) in zip(a, b) {
      if left != right { return count }
      count += 1
    }
    return count
  }
}

private func max(_ left: Double?, _ right: Double?) -> Double? {
  switch (left, right) {
  case (.none, .none):
    nil
  case (.some(let value), .none), (.none, .some(let value)):
    value
  case (.some(let left), .some(let right)):
    Swift.max(left, right)
  }
}
