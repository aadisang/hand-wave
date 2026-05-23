import { inferenceConfig } from "@/config/inference";
import type { Prediction as DetectionPrediction } from "@/types/detections";
import type { LandmarkFrame, StreamPrediction } from "@/types/inference";

export const {
  finalizedDisplayMs,
  idleFramesToFinalize,
  lostFramesToFinalize,
  minDecodeFrames,
  motionThreshold,
  strideFrames,
} = inferenceConfig.stream;

const minFrameIntervalMs = 1_000 / inferenceConfig.stream.targetFps;

type CandidateInput = {
  source: string;
  rawText: string;
  confidence: number;
  lmScore: number | null;
  modelAgrees: boolean;
};

type Candidate = CandidateInput & {
  text: string;
  score: number;
};

type DecodeContext = {
  latencyMs: number;
  idleFrames: number;
  motion: number;
};

type ScoredPrediction = {
  prediction: DetectionPrediction;
  score: number;
  source: string;
  lmScore: number | null;
  modelAgrees: boolean;
  streak: number;
};

type TraceAlternative = {
  label: string;
  rawLabel: string;
  confidence: number;
  logitScore: number | null;
  lmScore: number | null;
};

type TraceSpan = {
  text: string;
  startFrame: number;
  endFrame: number;
};

export type DecodeTrace = {
  bufferedFrames: number;
  rawLabel: string;
  rawCtcLabel: string;
  rawLogitScore: number | null;
  rawLmScore: number | null;
  partialText: string;
  stableText: string;
  greedyText: string;
  selectedText: string;
  selectedSource: string;
  selectedConfidence: number;
  displayText: string;
  blankRatio: number;
  tailBlankRatio: number;
  tailBlankFrames: number;
  alternatives: TraceAlternative[];
  spans: TraceSpan[];
  idleFrames: number;
  motion: number;
  latencyMs: number;
};

export type FinalizeTrace = {
  text: string;
  displayText: string;
  confidence: number;
  source: string;
  lmScore: number | null;
  modelAgrees: boolean;
  selectedStreak: number;
  seenCount: number;
  committed: boolean;
  endpointReason: EndpointReason;
  idleFrames: number;
  missingFrames: number;
  segmentFrames: number;
  displayScore: number;
};

export type EndpointReason = "idle" | "landmark-lost";

export type FinalizeContext = {
  endpointReason: EndpointReason;
  idleFrames: number;
  missingFrames: number;
  segmentFrames: number;
};

export type ArbitrationUpdate = {
  displayPrediction: DetectionPrediction | null;
  trace: DecodeTrace;
};

export type FinalizedPrediction = {
  displayPrediction: DetectionPrediction | null;
  committed: boolean;
  trace: FinalizeTrace;
};

export function createInferenceArbitrator() {
  let display: ScoredPrediction | null = null;
  let selectedText = "";
  let selectedStreak = 0;
  let displayMisses = 0;
  let finalCandidate: ScoredPrediction | null = null;
  const counts = new Map<string, number>();

  const reset = () => {
    display = null;
    selectedText = "";
    selectedStreak = 0;
    displayMisses = 0;
    finalCandidate = null;
    counts.clear();
  };

  const accept = (
    response: StreamPrediction,
    context: DecodeContext,
  ): ArbitrationUpdate => {
    const rawLabel = response.prediction.label.trim();
    const partialText = response.partial_text.trim();
    const stableText = response.stable_text.trim();
    const greedyText = response.greedy_text.trim();
    const candidate = selectCandidate(
      response,
      rawLabel,
      partialText,
      display?.prediction.text ?? "",
    );
    const seenCount = candidate ? (counts.get(candidate.text) ?? 0) + 1 : 0;
    const streak = candidate ? updateStreak(candidate.text) : 0;
    if (candidate) counts.set(candidate.text, seenCount);

    const prediction = candidate
      ? {
          text: candidate.text,
          confidence: candidate.confidence,
          processingTimeMs: context.latencyMs,
        }
      : null;
    const score = candidate
      ? candidate.score + Math.min(seenCount, 4) * 0.35
      : Number.NEGATIVE_INFINITY;

    if (candidate && prediction) {
      finalCandidate = bestFinalCandidate(
        finalCandidate,
        candidate,
        prediction,
        score,
        streak,
      );

      const misses =
        display && candidate.text !== display.prediction.text
          ? displayMisses + 1
          : 0;
      if (display && candidate.text === display.prediction.text) {
        display = mergeSamePrediction(display, {
          prediction: {
            ...prediction,
            confidence: Math.max(
              prediction.confidence,
              display.prediction.confidence,
            ),
          },
          score: Math.max(score, display.score),
          source: candidate.source,
          lmScore: candidate.lmScore,
          modelAgrees: candidate.modelAgrees,
          streak,
        });
        displayMisses = 0;
      } else if (
        shouldReplace(
          candidate,
          score,
          seenCount,
          streak,
          misses,
          context,
          display,
        )
      ) {
        display = scoredPrediction(candidate, prediction, score, streak);
        displayMisses = 0;
      } else {
        displayMisses = misses;
      }
    }

    const visible = display?.prediction ?? null;
    return {
      displayPrediction: visible ? toDisplayPrediction(visible) : null,
      trace: {
        bufferedFrames: response.buffered_frames,
        rawLabel,
        rawCtcLabel: response.prediction.raw_label ?? rawLabel,
        rawLogitScore: response.prediction.logit_score ?? null,
        rawLmScore: response.prediction.lm_score ?? null,
        partialText,
        stableText,
        greedyText,
        selectedText: candidate?.text ?? "",
        selectedSource: candidate?.source ?? "",
        selectedConfidence: candidate?.confidence ?? 0,
        displayText: display?.prediction.text ?? "",
        blankRatio: response.blank_ratio,
        tailBlankRatio: response.tail_blank_ratio,
        tailBlankFrames: response.tail_blank_frames,
        alternatives: response.alternatives.map((alternative) => ({
          label: alternative.label,
          rawLabel: alternative.raw_label ?? alternative.label,
          confidence: alternative.confidence,
          logitScore: alternative.logit_score ?? null,
          lmScore: alternative.lm_score ?? null,
        })),
        spans: response.spans.map((span) => ({
          text: span.text,
          startFrame: span.start_frame,
          endFrame: span.end_frame,
        })),
        idleFrames: context.idleFrames,
        motion: context.motion,
        latencyMs: context.latencyMs,
      },
    };
  };

  const finalize = (context: FinalizeContext): FinalizedPrediction => {
    const activeDisplay = display ?? null;
    const activeFinal = finalCandidate ?? null;
    const selected = preferredFinalPrediction(activeDisplay, activeFinal);
    const prediction = selected?.prediction ?? null;
    const seenCount = prediction ? (counts.get(prediction.text) ?? 0) : 0;
    const committed = selected
      ? shouldCommitPrediction(selected, seenCount)
      : false;

    return {
      displayPrediction:
        committed && prediction ? toDisplayPrediction(prediction) : null,
      committed,
      trace: {
        text: prediction?.text ?? "",
        displayText: prediction ? formatPredictionText(prediction.text) : "",
        confidence: prediction?.confidence ?? 0,
        source: selected?.source ?? "",
        lmScore: selected?.lmScore ?? null,
        modelAgrees: selected?.modelAgrees ?? false,
        selectedStreak: selected?.streak ?? 0,
        seenCount,
        committed,
        endpointReason: context.endpointReason,
        idleFrames: context.idleFrames,
        missingFrames: context.missingFrames,
        segmentFrames: context.segmentFrames,
        displayScore: selected?.score ?? 0,
      },
    };
  };

  const updateStreak = (text: string) => {
    selectedStreak = selectedText === text ? selectedStreak + 1 : 1;
    selectedText = text;
    return selectedStreak;
  };

  return { accept, finalize, reset };
}

export function toDisplayPrediction(
  prediction: DetectionPrediction,
): DetectionPrediction {
  return {
    ...prediction,
    text: formatPredictionText(prediction.text),
  };
}

export function acceptedFrameTime(lastAcceptedFrameMs: number) {
  const timestampMs = performance.now();
  return timestampMs - lastAcceptedFrameMs < minFrameIntervalMs
    ? null
    : timestampMs;
}

export function frameMotion(
  previous: LandmarkFrame | null,
  current: LandmarkFrame,
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
  return cleanPredictionText(text);
}

function selectCandidate(
  response: StreamPrediction,
  rawLabel: string,
  partialText: string,
  previousDisplayText: string,
) {
  const raw = cleanPredictionText(rawLabel);
  const inputs: CandidateInput[] = [
    {
      source: "partial",
      rawText: partialText,
      confidence: response.prediction.confidence,
      lmScore: response.prediction.lm_score ?? null,
      modelAgrees:
        cleanPredictionText(partialText) ===
        cleanPredictionText(response.greedy_text),
    },
    {
      source: "raw",
      rawText: rawLabel,
      confidence: response.prediction.confidence,
      lmScore: response.prediction.lm_score ?? null,
      modelAgrees: raw === cleanPredictionText(response.greedy_text),
    },
    ...response.alternatives.map((alternative, index) => ({
      source: `alt ${index + 1}`,
      rawText: alternative.label.trim(),
      confidence: alternative.confidence,
      lmScore: alternative.lm_score ?? null,
      modelAgrees: false,
    })),
  ];

  return inputs.reduce<Candidate | null>((best, input) => {
    const text = cleanPredictionText(input.rawText);
    if (!text || isSuspiciousAlternativeTail(input.source, text, raw)) {
      return best;
    }

    const candidate = {
      ...input,
      text,
      score: scoreCandidate(input, text, previousDisplayText, raw),
    };
    return !best || candidate.score > best.score ? candidate : best;
  }, null);
}

function shouldCommitPrediction(
  candidate: ScoredPrediction,
  seenCount: number,
) {
  const { prediction, lmScore, streak } = candidate;
  const compactLength = compactPredictionText(prediction.text).length;
  const singleToken = !prediction.text.includes(" ");

  if (compactLength === 1) {
    return (
      prediction.confidence >= 0.5 ||
      (seenCount >= 4 && streak >= 2 && prediction.confidence >= 0.22)
    );
  }
  if (compactLength <= 3) {
    return (
      (seenCount >= 3 && streak >= 2 && prediction.confidence >= 0.28) ||
      prediction.confidence >= 0.65
    );
  }

  if (isWeakLanguageMatch(candidate)) {
    return (
      prediction.confidence >= 0.9 ||
      (seenCount >= 5 && streak >= 3 && prediction.confidence >= 0.75)
    );
  }

  if (
    !singleToken &&
    lmScore !== null &&
    lmScore >= 1.8 &&
    !hasSuspiciousShortToken(prediction.text)
  ) {
    return (
      (seenCount >= 2 && prediction.confidence >= 0.24) ||
      (seenCount >= 3 && prediction.confidence >= 0.18) ||
      prediction.confidence >= 0.7
    );
  }

  if (singleToken && compactLength >= 7) {
    return (
      (seenCount >= 1 && prediction.confidence >= 0.32) ||
      prediction.confidence >= 0.75
    );
  }
  if (singleToken) {
    return (
      (seenCount >= 2 && prediction.confidence >= 0.28) ||
      prediction.confidence >= 0.75
    );
  }
  return (
    (seenCount >= 2 && prediction.confidence >= 0.35) ||
    prediction.confidence >= 0.75
  );
}

function isWeakLanguageMatch(candidate: ScoredPrediction) {
  const compactLength = compactPredictionText(candidate.prediction.text).length;
  return (
    compactLength >= 7 &&
    candidate.lmScore !== null &&
    candidate.lmScore <= -1.2
  );
}

function shouldReplace(
  candidate: Candidate,
  score: number,
  seenCount: number,
  streak: number,
  misses: number,
  context: DecodeContext,
  display: ScoredPrediction | null,
) {
  if (!display) return shouldStartDisplay(candidate, seenCount, streak);

  const current = display.prediction.text;
  if (isRollingWindowSuffix(current, candidate.text)) return false;
  if (isSpacedVariantOfCurrent(current, candidate.text)) return false;

  const shared = commonPrefixLength(candidate.text, current);
  const isOneCharTail =
    current.length >= 4 &&
    candidate.text.startsWith(current) &&
    candidate.text.length === current.length + 1;

  if (isOneCharTail) {
    return (
      candidate.source === "raw" &&
      candidate.modelAgrees &&
      seenCount >= 2 &&
      streak >= 2 &&
      candidate.confidence >= 0.45 &&
      (candidate.lmScore === null ||
        candidate.lmScore >= -0.25 ||
        display.prediction.confidence < 0.2) &&
      score >= display.score - (context.idleFrames > 0 ? 1.25 : 0.5)
    );
  }

  if (
    candidate.text.length >= current.length + 4 &&
    shared >= 2 &&
    score >= display.score - 3
  ) {
    return true;
  }

  if (
    candidate.source === "raw" &&
    candidate.text.startsWith(current) &&
    candidate.text.length >= current.length + 3 &&
    candidate.confidence >= 0.25
  ) {
    return score >= display.score - 3.5;
  }

  if (
    candidate.source === "raw" &&
    candidate.text.length >= 4 &&
    compactPredictionText(candidate.text).length >=
      compactPredictionText(current).length &&
    candidate.confidence >= display.prediction.confidence + 0.08
  ) {
    return true;
  }

  if (candidate.source === "raw" && streak >= 2 && misses >= 3) {
    return candidate.text.length >= 3 && score >= display.score - 4;
  }

  if (candidate.text.startsWith(current)) {
    return score >= display.score - 1.2;
  }

  if (
    current.startsWith(candidate.text) &&
    current.length - candidate.text.length <= 2
  ) {
    return seenCount >= 2 && score >= display.score - 1;
  }

  if (shared >= 4 && Math.abs(candidate.text.length - current.length) <= 3) {
    return score >= display.score - 0.8;
  }

  return score >= display.score + 0.25;
}

function shouldStartDisplay(
  candidate: Candidate,
  seenCount: number,
  streak: number,
) {
  const compactLength = compactPredictionText(candidate.text).length;

  if (compactLength === 1) {
    return (
      candidate.confidence >= 0.12 ||
      (seenCount >= 3 && candidate.confidence >= 0.05)
    );
  }
  if (compactLength <= 3) {
    return (
      candidate.confidence >= 0.18 ||
      (streak >= 3 && candidate.confidence >= 0.1)
    );
  }
  if (candidate.text.includes(" ")) {
    return (
      candidate.confidence >= 0.2 ||
      (streak >= 3 && candidate.confidence >= 0.14)
    );
  }
  if (compactLength >= 7) {
    return (
      candidate.confidence >= 0.22 ||
      (streak >= 2 && candidate.confidence >= 0.16)
    );
  }
  return (
    candidate.confidence >= 0.18 ||
    (streak >= 2 && candidate.confidence >= 0.12)
  );
}

function bestFinalCandidate(
  current: ScoredPrediction | null,
  candidate: Candidate,
  prediction: DetectionPrediction,
  score: number,
  streak: number,
) {
  if (!isReliableFinalCandidate(candidate)) return current;

  const next = scoredPrediction(candidate, prediction, score, streak);
  if (!current) return next;
  return shouldPreferFinalCandidate(next, current) ? next : current;
}

function shouldPreferFinalCandidate(
  next: ScoredPrediction,
  current: ScoredPrediction,
) {
  if (next.prediction.text === current.prediction.text) {
    return next.prediction.confidence > current.prediction.confidence;
  }
  if (
    isOneOrTwoCharacterCompletion(current.prediction.text, next.prediction.text)
  ) {
    return (
      next.prediction.confidence >= 0.45 && next.score >= current.score - 0.5
    );
  }
  return (
    next.prediction.confidence >= current.prediction.confidence + 0.12 &&
    next.score >= current.score - 0.5
  );
}

function isReliableFinalCandidate(candidate: Candidate) {
  if (candidate.source !== "raw" || !candidate.modelAgrees) return false;
  if (candidate.lmScore !== null && candidate.lmScore < -0.3) return false;

  const compactLength = compactPredictionText(candidate.text).length;
  if (compactLength === 1) return candidate.confidence >= 0.3;
  if (compactLength <= 3) return candidate.confidence >= 0.55;
  return candidate.confidence >= 0.45;
}

function scoredPrediction(
  candidate: Candidate,
  prediction: DetectionPrediction,
  score: number,
  streak: number,
): ScoredPrediction {
  return {
    prediction,
    score,
    source: candidate.source,
    lmScore: candidate.lmScore,
    modelAgrees: candidate.modelAgrees,
    streak,
  };
}

function mergeSamePrediction(
  current: ScoredPrediction,
  next: ScoredPrediction,
): ScoredPrediction {
  return {
    prediction: next.prediction,
    score: Math.max(current.score, next.score),
    source: next.source,
    lmScore: maxNullable(current.lmScore, next.lmScore),
    modelAgrees: current.modelAgrees || next.modelAgrees,
    streak: Math.max(current.streak, next.streak),
  };
}

function maxNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function preferredFinalPrediction(
  display: ScoredPrediction | null,
  final: ScoredPrediction | null,
) {
  if (!display) return final;
  if (!final) return display;
  if (display.prediction.text === final.prediction.text) {
    return final.prediction.confidence > display.prediction.confidence
      ? final
      : display;
  }

  if (
    isOneOrTwoCharacterCompletion(display.prediction.text, final.prediction.text)
  ) {
    return final.score >= display.score - 0.5 ? final : display;
  }

  if (
    display.prediction.confidence < 0.2 &&
    final.prediction.confidence >= 0.45
  ) {
    return final;
  }

  return final.prediction.confidence >= display.prediction.confidence + 0.25 &&
    final.score >= display.score
    ? final
    : display;
}

function isSuspiciousAlternativeTail(
  source: string,
  text: string,
  raw: string,
) {
  if (!source.startsWith("alt")) return false;
  const extra = text.length - raw.length;
  return raw && text.startsWith(raw) && extra > 0 && extra <= 2;
}

function cleanPredictionText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPredictionText(text: string) {
  return cleanPredictionText(text).replace(/\s+/g, "");
}

function isRollingWindowSuffix(current: string, candidate: string) {
  const currentCompact = compactPredictionText(current);
  const candidateCompact = compactPredictionText(candidate);
  return (
    currentCompact.length >= 10 &&
    candidateCompact.length >= 4 &&
    currentCompact.endsWith(candidateCompact) &&
    currentCompact.length - candidateCompact.length >= 3
  );
}

function isSpacedVariantOfCurrent(current: string, candidate: string) {
  const currentCompact = compactPredictionText(current);
  const candidateCompact = compactPredictionText(candidate);
  return (
    !current.includes(" ") &&
    candidate.includes(" ") &&
    isWithinOneEdit(currentCompact, candidateCompact)
  );
}

const commonShortWords = new Set([
  "a",
  "i",
  "ad",
  "ai",
  "am",
  "an",
  "ar",
  "as",
  "at",
  "be",
  "by",
  "dc",
  "do",
  "dr",
  "eu",
  "go",
  "he",
  "hi",
  "id",
  "if",
  "in",
  "is",
  "it",
  "la",
  "me",
  "mr",
  "ms",
  "my",
  "no",
  "ny",
  "of",
  "oh",
  "ok",
  "on",
  "or",
  "os",
  "pc",
  "so",
  "to",
  "tv",
  "uk",
  "un",
  "up",
  "us",
  "vr",
  "we",
]);

function hasSuspiciousShortToken(text: string) {
  const clean = cleanPredictionText(text);
  if (!clean.includes(" ")) return false;
  return clean
    .split(" ")
    .some((token) => token.length <= 2 && !commonShortWords.has(token));
}

function isOneOrTwoCharacterCompletion(current: string, candidate: string) {
  const currentCompact = compactPredictionText(current);
  const candidateCompact = compactPredictionText(candidate);
  return (
    currentCompact.length >= 3 &&
    candidateCompact.startsWith(currentCompact) &&
    candidateCompact.length - currentCompact.length > 0 &&
    candidateCompact.length - currentCompact.length <= 2
  );
}

function isWithinOneEdit(a: string, b: string) {
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

function scoreCandidate(
  input: CandidateInput,
  text: string,
  previous: string,
  raw: string,
) {
  const { source, confidence, lmScore, rawText } = input;
  const punctuationPenalty = rawText.replace(/[a-z0-9 ]/gi, "").length * 0.5;
  const primaryBonus = source === "raw" ? 0.75 : 0;
  const altPenalty = source.startsWith("alt") ? 0.8 : 0;
  const languageScore = clamp(lmScore ?? 0, -2.5, 3.5) * 0.45;
  const extensionBonus =
    source === "raw" && previous.length >= 3 && text.startsWith(previous)
      ? 1.1
      : 0;
  const tailFixBonus =
    text.length >= 4 &&
    previous.startsWith(text) &&
    previous.length - text.length <= 2
      ? 0.65
      : 0;
  const altTailPenalty =
    source.startsWith("alt") &&
    ((raw.length >= 3 && text.startsWith(raw)) ||
      (previous.length >= 3 && text.startsWith(previous)))
      ? 1.8
      : 0;

  return (
    confidence * 2 +
    languageScore +
    Math.min(text.length, 14) * 0.08 +
    primaryBonus +
    extensionBonus +
    tailFixBonus +
    (/^[a-z0-9]$/u.test(text) ? 0.35 : 0) -
    punctuationPenalty -
    altPenalty -
    altTailPenalty -
    (/(.)\1$/u.test(text) ? 0.25 : 0) -
    (text.length <= 3 && text.includes(" ") ? 0.75 : 0) -
    (hasSuspiciousShortToken(text) ? 0.45 : 0) -
    (previous.length >= 4 && commonPrefixLength(text, previous) < 3 ? 2.5 : 0)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function commonPrefixLength(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}
