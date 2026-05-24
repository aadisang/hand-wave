import * as Number from "effect/Number";
import { cfg } from "@hand-wave/contract";
import type { Prediction as DetectionPrediction } from "@/types/detections";
import type {
  Candidate,
  CandidateIn,
  ArbiterUpdate,
  Source,
  Threshold,
  DecodeCtx,
  DecisionState,
  FinalCtx,
  FinalPred,
  Frame,
  TextKind,
  Scored,
  StreamPred,
} from "@/types/inference";

export const {
  holdMs,
  idle,
  lost,
  min: minFrames,
  motion: motionMin,
  stride,
} = cfg.stream;

const minFrameMs = 1_000 / cfg.stream.fps;

const displayThresholds = {
  letter: { instant: 0.12, seen: 3, streak: 1, confidence: 0.05 },
  short: { instant: 0.18, seen: 1, streak: 3, confidence: 0.1 },
  phrase: { instant: 0.2, seen: 1, streak: 3, confidence: 0.14 },
  long: { instant: 0.22, seen: 1, streak: 2, confidence: 0.16 },
  word: { instant: 0.18, seen: 1, streak: 2, confidence: 0.12 },
} satisfies Record<TextKind, Threshold>;

const commitThresholds = {
  letter: { instant: 0.5, seen: 4, streak: 2, confidence: 0.22 },
  short: { instant: 0.65, seen: 3, streak: 2, confidence: 0.28 },
  phrase: { instant: 0.75, seen: 3, streak: 1, confidence: 0.29 },
  long: { instant: 0.75, seen: 1, streak: 1, confidence: 0.32 },
  word: { instant: 0.75, seen: 2, streak: 1, confidence: 0.28 },
} satisfies Record<TextKind, Threshold>;

const finalConfidence = {
  letter: 0.3,
  short: 0.55,
  phrase: 0.45,
  long: 0.45,
  word: 0.45,
} satisfies Record<TextKind, number>;

export function createArbiter() {
  let display: Scored | null = null;
  let finalCandidate: Scored | null = null;
  let selectedText = "";
  let selectedStreak = 0;
  let displayMisses = 0;
  const counts = new Map<string, number>();

  const reset = () => {
    display = null;
    finalCandidate = null;
    selectedText = "";
    selectedStreak = 0;
    displayMisses = 0;
    counts.clear();
  };

  const streakFor = (text: string) => {
    selectedStreak = selectedText === text ? selectedStreak + 1 : 1;
    selectedText = text;
    return selectedStreak;
  };

  const accept = (
    response: StreamPred,
    context: DecodeCtx,
  ): ArbiterUpdate => {
    const rawLabel = response.prediction.label.trim();
    const partialText = response.partial_text.trim();
    const candidate = selectCandidate(
      response,
      rawLabel,
      partialText,
      display?.prediction.text ?? "",
    );

    if (candidate) {
      const seenCount = (counts.get(candidate.text) ?? 0) + 1;
      const streak = streakFor(candidate.text);
      const score = candidate.score + Math.min(seenCount, 4) * 0.35;
      const prediction = {
        text: candidate.text,
        confidence: candidate.confidence,
        processingTimeMs: context.latencyMs,
      };
      counts.set(candidate.text, seenCount);
      finalCandidate = preferredFinal(
        finalCandidate,
        scored(candidate, prediction, score, streak),
      );

      const misses =
        display && candidate.text !== display.prediction.text
          ? displayMisses + 1
          : 0;
      const next = scored(candidate, prediction, score, streak);
      if (display && candidate.text === display.prediction.text) {
        display = mergeSame(display, next);
        displayMisses = 0;
      } else if (
        shouldDisplay(next, display, {
          context,
          misses,
          seenCount,
          score,
          streak,
        })
      ) {
        display = next;
        displayMisses = 0;
      } else {
        displayMisses = misses;
      }
    }

    return {
      displayPrediction: display
        ? toDisplayPrediction(display.prediction)
        : null,
      trace: traceDecode(response, context, rawLabel, display),
    };
  };

  const finalize = (context: FinalCtx): FinalPred => {
    const selected = pickFinalPred(display, finalCandidate);
    const prediction = selected?.prediction ?? null;
    const seenCount = prediction ? (counts.get(prediction.text) ?? 0) : 0;
    const committed = selected ? shouldCommit(selected, seenCount) : false;

    return {
      displayPrediction:
        committed && prediction ? toDisplayPrediction(prediction) : null,
      committed,
      trace: {
        text: prediction?.text ?? "",
        confidence: prediction?.confidence ?? 0,
        committed,
        endpointReason: context.endpointReason,
        segmentFrames: context.segmentFrames,
      },
    };
  };

  return { accept, finalize, reset };
}

export function toDisplayPrediction(
  prediction: DetectionPrediction,
): DetectionPrediction {
  return { ...prediction, text: formatPredictionText(prediction.text) };
}

export function acceptedFrameTime(lastAcceptedFrameMs: number) {
  const timestampMs = performance.now();
  return timestampMs - lastAcceptedFrameMs < minFrameMs
    ? null
    : timestampMs;
}

export function frameMotion(
  previous: Frame | null,
  current: Frame,
) {
  if (!previous) return 0;
  const count = Math.min(21, previous.length / 3, current.length / 3);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    total +=
      Math.abs(previous[offset] - current[offset]) +
      Math.abs(previous[offset + 1] - current[offset + 1]);
  }
  return total / count;
}

export function formatPredictionText(text: string) {
  return clean(text);
}

function traceDecode(
  response: StreamPred,
  context: DecodeCtx,
  rawLabel: string,
  display: Scored | null,
) {
  return {
    bufferedFrames: response.buffered_frames,
    inputText: rawLabel,
    displayText: display?.prediction.text ?? "",
    idleFrames: context.idleFrames,
    motion: context.motion,
    latencyMs: context.latencyMs,
  };
}

function selectCandidate(
  response: StreamPred,
  rawLabel: string,
  partialText: string,
  previousDisplayText: string,
) {
  const raw = clean(rawLabel);
  const inputs: CandidateIn[] = [
    input(
      "partial",
      partialText,
      response,
      clean(partialText) === clean(response.greedy_text),
    ),
    input("raw", rawLabel, response, raw === clean(response.greedy_text)),
    ...response.alternatives.map((alternative, index) => ({
      source: `alt ${index + 1}` as const,
      rawText: alternative.label.trim(),
      confidence: alternative.confidence,
      lmScore: alternative.lm_score ?? null,
      modelAgrees: false,
    })),
  ];

  let best: Candidate | null = null;
  for (const item of inputs) {
    const text = clean(item.rawText);
    if (!text) continue;
    if (badAltTail(item.source, text, raw)) continue;

    const candidate = {
      ...item,
      text,
      score: scoreFor(item, text, previousDisplayText, raw),
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }
  return best;
}

function input(
  source: Source,
  rawText: string,
  response: StreamPred,
  modelAgrees: boolean,
) {
  return {
    source,
    rawText,
    confidence: response.prediction.confidence,
    lmScore: response.prediction.lm_score ?? null,
    modelAgrees,
  };
}

function shouldDisplay(
  next: Scored,
  display: Scored | null,
  state: DecisionState,
) {
  if (!display) {
    return passesThreshold(
      displayThresholds[kind(next.prediction.text)],
      next,
      state,
    );
  }

  const current = display.prediction.text;
  const candidate = next.prediction.text;
  if (keepCurrent(current, candidate)) {
    return false;
  }

  if (singleTail(current, candidate)) {
    return acceptsTail(next, display, state);
  }

  if (acceptsFix(next, display, state)) return true;
  if (acceptsRawExtension(next, display, state)) return true;
  if (acceptsRaw(next, display)) return true;
  if (acceptsRepeat(next, display, state)) return true;
  if (acceptsExtend(next, display, state)) return true;
  if (acceptsPrefix(next, display, state)) return true;
  if (acceptsSimilar(next, display, state)) return true;
  return state.score >= display.score + 0.25;
}

function shouldCommit(candidate: Scored, seenCount: number) {
  const prediction = candidate.prediction;
  const weakLanguage =
    compact(prediction.text).length >= 7 &&
    candidate.lmScore !== null &&
    candidate.lmScore <= -1.2;

  if (weakLanguage) {
    return (
      prediction.confidence >= 0.9 ||
      (seenCount >= 5 && candidate.streak >= 3 && prediction.confidence >= 0.75)
    );
  }

  return passesThreshold(commitThresholds[kind(prediction.text)], candidate, {
    seenCount,
    streak: candidate.streak,
  });
}

function keepCurrent(current: string, candidate: string) {
  return isSuffixWindow(current, candidate) || isSpacedVariant(current, candidate);
}

function acceptsTail(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  const idlePenalty = state.context.idleFrames > 0 ? 1.25 : 0.5;
  const languageAllowsTail =
    next.lmScore === null ||
    next.lmScore >= -0.25 ||
    display.prediction.confidence < 0.2;

  return (
    next.source === "raw" &&
    next.modelAgrees &&
    state.seenCount >= 2 &&
    state.streak >= 2 &&
    next.prediction.confidence >= 0.45 &&
    languageAllowsTail &&
    state.score >= display.score - idlePenalty
  );
}

function acceptsFix(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  const current = display.prediction.text;
  const candidate = next.prediction.text;
  return (
    candidate.length >= current.length + 4 &&
    prefixLen(candidate, current) >= 2 &&
    state.score >= display.score - 3
  );
}

function acceptsRawExtension(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  const current = display.prediction.text;
  const candidate = next.prediction.text;
  return (
    next.source === "raw" &&
    candidate.startsWith(current) &&
    candidate.length >= current.length + 3 &&
    next.prediction.confidence >= 0.25 &&
    state.score >= display.score - 3.5
  );
}

function acceptsRaw(
  next: Scored,
  display: Scored,
) {
  return (
    next.source === "raw" &&
    next.prediction.text.length >= 4 &&
    compact(next.prediction.text).length >=
      compact(display.prediction.text).length &&
    next.prediction.confidence >= display.prediction.confidence + 0.08
  );
}

function acceptsRepeat(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  return (
    next.source === "raw" &&
    state.streak >= 2 &&
    state.misses >= 3 &&
    next.prediction.text.length >= 3 &&
    state.score >= display.score - 4
  );
}

function acceptsExtend(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  return (
    next.prediction.text.startsWith(display.prediction.text) &&
    state.score >= display.score - 1.2
  );
}

function acceptsPrefix(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  const current = display.prediction.text;
  const candidate = next.prediction.text;
  return (
    current.startsWith(candidate) &&
    current.length - candidate.length <= 2 &&
    state.seenCount >= 2 &&
    state.score >= display.score - 1
  );
}

function acceptsSimilar(
  next: Scored,
  display: Scored,
  state: DecisionState,
) {
  const current = display.prediction.text;
  const candidate = next.prediction.text;
  return (
    prefixLen(candidate, current) >= 4 &&
    Math.abs(candidate.length - current.length) <= 3 &&
    state.score >= display.score - 0.8
  );
}

function passesThreshold(
  threshold: Threshold,
  candidate: Scored,
  state: { seenCount: number; streak: number },
) {
  return (
    candidate.prediction.confidence >= threshold.instant ||
    (state.seenCount >= threshold.seen &&
      state.streak >= threshold.streak &&
      candidate.prediction.confidence >= threshold.confidence)
  );
}

function preferredFinal(
  current: Scored | null,
  next: Scored,
) {
  const reliable =
    next.source === "raw" &&
    next.modelAgrees &&
    (next.lmScore === null || next.lmScore >= -0.3) &&
    next.prediction.confidence >= finalConfidence[kind(next.prediction.text)];
  if (!reliable) return current;
  if (!current) return next;
  if (next.prediction.text === current.prediction.text) {
    return next.prediction.confidence > current.prediction.confidence
      ? next
      : current;
  }
  if (shortFinish(current.prediction.text, next.prediction.text)) {
    return next.prediction.confidence >= 0.45 &&
      next.score >= current.score - 0.5
      ? next
      : current;
  }
  return next.prediction.confidence >= current.prediction.confidence + 0.12 &&
    next.score >= current.score - 0.5
    ? next
    : current;
}

function pickFinalPred(
  display: Scored | null,
  final: Scored | null,
) {
  if (!display) return final;
  if (!final) return display;
  if (display.prediction.text === final.prediction.text) {
    return final.prediction.confidence > display.prediction.confidence
      ? final
      : display;
  }
  if (shortFinish(display.prediction.text, final.prediction.text)) {
    return final.score >= display.score - 0.5 ? final : display;
  }
  return (display.prediction.confidence < 0.2 &&
    final.prediction.confidence >= 0.45) ||
    (final.prediction.confidence >= display.prediction.confidence + 0.25 &&
      final.score >= display.score)
    ? final
    : display;
}

function scored(
  candidate: Candidate,
  prediction: DetectionPrediction,
  score: number,
  streak: number,
): Scored {
  return {
    prediction,
    score,
    source: candidate.source,
    lmScore: candidate.lmScore,
    modelAgrees: candidate.modelAgrees,
    streak,
  };
}

function mergeSame(current: Scored, next: Scored) {
  return {
    prediction: {
      ...next.prediction,
      confidence: Math.max(
        current.prediction.confidence,
        next.prediction.confidence,
      ),
    },
    score: Math.max(current.score, next.score),
    source: next.source,
    lmScore: maxNullable(current.lmScore, next.lmScore),
    modelAgrees: current.modelAgrees || next.modelAgrees,
    streak: Math.max(current.streak, next.streak),
  };
}

function scoreFor(
  candidate: CandidateIn,
  text: string,
  previous: string,
  raw: string,
) {
  let score = candidate.confidence * 2;
  score += lmScore(candidate);
  score += Math.min(text.length, 14) * 0.08;

  if (candidate.source === "raw") score += 0.75;
  if (extendsPreviousText(candidate, text, previous)) score += 1.1;
  if (repairsShortTail(text, previous)) score += 0.65;
  if (/^[a-z0-9]$/u.test(text)) score += 0.35;

  score -= punctPenalty(candidate.rawText);
  if (candidate.source.startsWith("alt")) score -= 0.8;
  if (altExtendsKnown(candidate, text, raw, previous)) score -= 1.8;
  if (/(.)\1$/u.test(text)) score -= 0.25;
  if (text.length <= 3 && text.includes(" ")) score -= 0.75;
  if (previous.length >= 4 && prefixLen(text, previous) < 3) score -= 2.5;
  return score;
}

function lmScore(candidate: CandidateIn) {
  return (
    Number.clamp(candidate.lmScore ?? 0, { minimum: -2.5, maximum: 3.5 }) * 0.45
  );
}

function punctPenalty(text: string) {
  return text.replace(/[a-z0-9 ]/gi, "").length * 0.5;
}

function extendsPreviousText(
  candidate: CandidateIn,
  text: string,
  previous: string,
) {
  return (
    candidate.source === "raw" &&
    previous.length >= 3 &&
    text.startsWith(previous)
  );
}

function repairsShortTail(text: string, previous: string) {
  return (
    text.length >= 4 &&
    previous.startsWith(text) &&
    previous.length - text.length <= 2
  );
}

function altExtendsKnown(
  candidate: CandidateIn,
  text: string,
  raw: string,
  previous: string,
) {
  return (
    candidate.source.startsWith("alt") &&
    ((raw.length >= 3 && text.startsWith(raw)) ||
      (previous.length >= 3 && text.startsWith(previous)))
  );
}

function kind(text: string): TextKind {
  const cleaned = clean(text);
  const length = compact(cleaned).length;
  if (length === 1) return "letter";
  if (length <= 3) return "short";
  if (cleaned.includes(" ")) return "phrase";
  if (length >= 7) return "long";
  return "word";
}

function clean(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(text: string) {
  return clean(text).replace(/\s+/g, "");
}

function badAltTail(
  source: Source,
  text: string,
  raw: string,
) {
  const extra = text.length - raw.length;
  return (
    source.startsWith("alt") &&
    raw &&
    text.startsWith(raw) &&
    extra > 0 &&
    extra <= 2
  );
}

function isSuffixWindow(current: string, candidate: string) {
  const currentCompact = compact(current);
  const candidateCompact = compact(candidate);
  return (
    currentCompact.length >= 10 &&
    candidateCompact.length >= 4 &&
    currentCompact.endsWith(candidateCompact) &&
    currentCompact.length - candidateCompact.length >= 3
  );
}

function isSpacedVariant(current: string, candidate: string) {
  return (
    !current.includes(" ") &&
    candidate.includes(" ") &&
    nearEdit(compact(current), compact(candidate))
  );
}

function singleTail(current: string, candidate: string) {
  return (
    current.length >= 4 &&
    candidate.startsWith(current) &&
    candidate.length === current.length + 1
  );
}

function shortFinish(current: string, candidate: string) {
  const currentCompact = compact(current);
  const candidateCompact = compact(candidate);
  const delta = candidateCompact.length - currentCompact.length;
  return (
    currentCompact.length >= 3 &&
    candidateCompact.startsWith(currentCompact) &&
    delta > 0 &&
    delta <= 2
  );
}

function nearEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let edits = 0;
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else {
      edits += 1;
      if (edits > 1) return false;
      if (a.length > b.length) i += 1;
      else if (b.length > a.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
  }

  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

function prefixLen(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}

function maxNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
