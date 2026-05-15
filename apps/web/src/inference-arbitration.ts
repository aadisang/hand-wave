import type {
  LandmarkFrame,
  PredictionSpan,
  StreamPrediction,
} from "@/inference";
import type { Prediction as DetectionPrediction } from "@/stores/detections-store";

export const minDecodeFrames = 24;
export const strideFrames = 4;
export const idleFramesToFinalize = 16;
export const finalizedDisplayMs = 1_200;
export const motionThreshold = 0.003;

const targetInferenceFps = 24;
const minFrameIntervalMs = 1_000 / targetInferenceFps;

type PredictionCandidateInput = {
  source: string;
  rawText: string;
  confidence: number;
  logitScore?: number;
  lmScore?: number;
};

type PredictionCandidate = PredictionCandidateInput & {
  text: string;
  score: number;
};

type DecodeContext = {
  latencyMs: number;
  idleFrames: number;
  motion: number;
};

export type DecodeTrace = {
  bufferedFrames: number;
  rawLabel: string;
  partialText: string;
  greedyText: string;
  stableText: string;
  alternatives: string[];
  spans: PredictionSpan[];
  blankRatio: number;
  tailBlankRatio: number;
  tailBlankFrames: number;
  selectedText: string;
  selectedDisplayText: string;
  selectedSource: string;
  selectedConfidence: number;
  selectedScore: number;
  previousBestText: string;
  bestText: string;
  bestScore: number;
  seenCount: number;
  selectedStreak: number;
  bestMisses: number;
  idleFrames: number;
  motion: number;
  latencyMs: number;
};

export type FinalizeTrace = {
  text: string;
  displayText: string;
  confidence: number;
  seenCount: number;
  committed: boolean;
  idleFrames: number;
  bestScore: number;
};

export type ArbitrationUpdate = {
  prediction: DetectionPrediction | null;
  displayPrediction: DetectionPrediction | null;
  trace: DecodeTrace;
};

export type FinalizedPrediction = {
  prediction: DetectionPrediction | null;
  displayPrediction: DetectionPrediction | null;
  committed: boolean;
  trace: FinalizeTrace;
};

export class InferenceArbitrator {
  private latestPrediction: DetectionPrediction | null = null;
  private bestPrediction: DetectionPrediction | null = null;
  private bestPredictionScore = Number.NEGATIVE_INFINITY;
  private candidateCounts = new Map<string, number>();
  private selectedCandidateText = "";
  private selectedCandidateStreak = 0;
  private bestMisses = 0;

  reset() {
    this.latestPrediction = null;
    this.bestPrediction = null;
    this.bestPredictionScore = Number.NEGATIVE_INFINITY;
    this.candidateCounts.clear();
    this.selectedCandidateText = "";
    this.selectedCandidateStreak = 0;
    this.bestMisses = 0;
  }

  accept(
    response: StreamPrediction,
    context: DecodeContext,
  ): ArbitrationUpdate {
    const partialText = response.partial_text.trim();
    const rawLabel = response.prediction.label.trim();
    const greedyText = response.greedy_text.trim();
    const alternatives = response.alternatives.map((alternative) =>
      alternative.label.trim(),
    );
    const previousBestText = this.bestPrediction?.text ?? "";
    const candidate = selectPredictionCandidate(
      [
        {
          source: "partial",
          rawText: partialText,
          confidence: response.prediction.confidence,
        },
        {
          source: "raw",
          rawText: rawLabel,
          confidence: response.prediction.confidence,
          logitScore: response.prediction.logit_score ?? undefined,
          lmScore: response.prediction.lm_score ?? undefined,
        },
        {
          source: "greedy",
          rawText: greedyText,
          confidence: response.prediction.confidence * 0.9,
        },
        ...response.alternatives.map((alternative, index) => ({
          source: `alt ${index + 1}`,
          rawText: alternative.label.trim(),
          confidence: alternative.confidence,
          logitScore: alternative.logit_score ?? undefined,
          lmScore: alternative.lm_score ?? undefined,
        })),
      ],
      previousBestText,
    );

    const seenCount = candidate
      ? (this.candidateCounts.get(candidate.text) ?? 0) + 1
      : 0;
    if (candidate) this.candidateCounts.set(candidate.text, seenCount);

    const selectedStreak = candidate
      ? this.updateSelectedCandidateStreak(candidate.text)
      : 0;
    const currentBest = this.bestPrediction;
    const bestMisses =
      candidate && currentBest && candidate.text !== currentBest.text
        ? this.bestMisses + 1
        : 0;
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
      this.latestPrediction = prediction;
      if (
        shouldReplaceBest(
          candidate,
          score,
          seenCount,
          selectedStreak,
          bestMisses,
          context.idleFrames,
          currentBest,
          this.bestPredictionScore,
        )
      ) {
        this.bestPrediction = prediction;
        this.bestPredictionScore = score;
        this.bestMisses = 0;
      } else {
        this.bestMisses = bestMisses;
      }
    }

    const displayPrediction = this.bestPrediction ?? prediction;
    return {
      prediction,
      displayPrediction: displayPrediction
        ? toDisplayPrediction(displayPrediction)
        : null,
      trace: {
        bufferedFrames: response.buffered_frames,
        rawLabel,
        partialText,
        greedyText,
        stableText: response.stable_text.trim(),
        alternatives,
        spans: response.spans,
        blankRatio: response.blank_ratio,
        tailBlankRatio: response.tail_blank_ratio,
        tailBlankFrames: response.tail_blank_frames,
        selectedText: candidate?.text ?? "",
        selectedDisplayText: candidate
          ? formatPredictionText(candidate.text)
          : "",
        selectedSource: candidate?.source ?? "",
        selectedConfidence: candidate?.confidence ?? 0,
        selectedScore: Number.isFinite(score) ? score : 0,
        previousBestText,
        bestText: this.bestPrediction?.text ?? "",
        bestScore: Number.isFinite(this.bestPredictionScore)
          ? this.bestPredictionScore
          : 0,
        seenCount,
        selectedStreak,
        bestMisses: this.bestMisses,
        idleFrames: context.idleFrames,
        motion: context.motion,
        latencyMs: context.latencyMs,
      },
    };
  }

  finalize(idleFrames: number): FinalizedPrediction {
    const prediction = this.bestPrediction ?? this.latestPrediction;
    const seenCount = prediction
      ? (this.candidateCounts.get(prediction.text) ?? 0)
      : 0;
    const committed = prediction
      ? shouldCommitPrediction(prediction, seenCount)
      : false;
    const displayPrediction = prediction
      ? toDisplayPrediction(prediction)
      : null;
    return {
      prediction,
      displayPrediction,
      committed,
      trace: {
        text: prediction?.text ?? "",
        displayText: prediction ? formatPredictionText(prediction.text) : "",
        confidence: prediction?.confidence ?? 0,
        seenCount,
        committed,
        idleFrames,
        bestScore: Number.isFinite(this.bestPredictionScore)
          ? this.bestPredictionScore
          : 0,
      },
    };
  }

  private updateSelectedCandidateStreak(text: string) {
    if (this.selectedCandidateText === text) {
      this.selectedCandidateStreak += 1;
    } else {
      this.selectedCandidateText = text;
      this.selectedCandidateStreak = 1;
    }
    return this.selectedCandidateStreak;
  }
}

export function logDecodeTrace(trace: DecodeTrace) {
  console.groupCollapsed(
    `[handwave:decode] selected="${trace.selectedText || "(empty)"}" source="${trace.selectedSource || "(none)"}" raw="${trace.rawLabel || "(empty)"}" best="${trace.bestText || "(empty)"}"`,
  );
  console.log({
    selected: trace.selectedText,
    selectedDisplay: trace.selectedDisplayText,
    selectedSource: trace.selectedSource,
    selectedConfidence: trace.selectedConfidence,
    selectedScore: trace.selectedScore,
    previousBest: trace.previousBestText,
    best: trace.bestText,
    bestScore: trace.bestScore,
    seenCount: trace.seenCount,
    selectedStreak: trace.selectedStreak,
    bestMisses: trace.bestMisses,
    raw: trace.rawLabel,
    greedy: trace.greedyText,
    partial: trace.partialText,
    stable: trace.stableText,
    alternatives: trace.alternatives,
    spans: trace.spans,
    blankRatio: trace.blankRatio,
    tailBlankRatio: trace.tailBlankRatio,
    tailBlankFrames: trace.tailBlankFrames,
    bufferedFrames: trace.bufferedFrames,
    idleFrames: trace.idleFrames,
    motion: trace.motion,
    latencyMs: trace.latencyMs,
  });
  console.table(
    [
      { source: "partial", text: trace.partialText },
      { source: "raw", text: trace.rawLabel },
      { source: "greedy", text: trace.greedyText },
      ...trace.alternatives.map((text, index) => ({
        source: `alt ${index + 1}`,
        text,
      })),
    ].filter((row) => row.text),
  );
  console.groupEnd();
}

export function logFinalizeTrace(trace: FinalizeTrace) {
  console.info("[handwave:finalize]", trace);
}

export function toDisplayPrediction(
  prediction: DetectionPrediction,
): DetectionPrediction {
  return {
    ...prediction,
    text: formatPredictionText(prediction.text),
  };
}

export function shouldAcceptFrame(
  frame: LandmarkFrame,
  lastAcceptedFrameMs: number,
) {
  const timestampMs =
    frame.timestamp_ms ?? performance.timeOrigin + performance.now();
  if (timestampMs - lastAcceptedFrameMs < minFrameIntervalMs) {
    return { accepted: false, timestampMs: lastAcceptedFrameMs };
  }
  return { accepted: true, timestampMs };
}

export function frameMotion(
  previous: LandmarkFrame | null,
  current: LandmarkFrame,
) {
  if (!previous) return 0;
  let total = 0;
  const count = Math.min(
    21,
    previous.landmarks.length,
    current.landmarks.length,
  );
  for (let i = 0; i < count; i += 1) {
    const a = previous.landmarks[i];
    const b = current.landmarks[i];
    total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return total / count;
}

export function formatPredictionText(text: string) {
  return cleanPredictionText(text);
}

function shouldCommitPrediction(
  prediction: DetectionPrediction,
  seenCount: number,
) {
  if (prediction.text.length === 1) {
    return (
      (seenCount >= 3 && prediction.confidence >= 0.12) ||
      prediction.confidence >= 0.55
    );
  }
  if (prediction.text.length <= 3) {
    return seenCount >= 3 || prediction.confidence >= 0.65;
  }
  return seenCount >= 2 || prediction.confidence >= 0.75;
}

function selectPredictionCandidate(
  candidates: PredictionCandidateInput[],
  previousBestText: string,
) {
  const primaryText = cleanPredictionText(
    candidates.find((candidate) => candidate.source === "raw")?.rawText ?? "",
  );
  const greedyText = cleanPredictionText(
    candidates.find((candidate) => candidate.source === "greedy")?.rawText ??
      "",
  );
  return candidates.reduce<PredictionCandidate | null>((best, candidate) => {
    const text = cleanPredictionText(candidate.rawText);
    if (text.length < 1) return best;
    if (
      isSuspiciousAlternativeTail(
        candidate.source,
        text,
        primaryText,
        greedyText,
      )
    ) {
      return best;
    }
    const scored = {
      ...candidate,
      text,
      score: scorePredictionCandidate(
        candidate.rawText,
        text,
        candidate.confidence,
        previousBestText,
        primaryText,
        greedyText,
        candidate.source,
      ),
    };
    if (!best || scored.score > best.score) return scored;
    return best;
  }, null);
}

function shouldReplaceBest(
  candidate: PredictionCandidate,
  score: number,
  seenCount: number,
  selectedStreak: number,
  bestMisses: number,
  idleFrames: number,
  best: DetectionPrediction | null,
  bestScore: number,
) {
  if (!best) return true;
  if (!Number.isFinite(bestScore)) return true;
  const sharedPrefixLength = commonPrefixLength(candidate.text, best.text);
  const isOneCharTailExtension =
    best.text.length >= 4 &&
    candidate.text.startsWith(best.text) &&
    candidate.text.length === best.text.length + 1;
  if (isOneCharTailExtension) {
    const requiredMargin = idleFrames > 0 ? 2.2 : 1.25;
    return (
      candidate.source === "raw" &&
      seenCount >= 3 &&
      selectedStreak >= 3 &&
      score >= bestScore + requiredMargin
    );
  }
  if (
    candidate.source === "greedy" &&
    sharedPrefixLength >= 3 &&
    candidate.text.length >= best.text.length - 1
  ) {
    return score >= bestScore - 2 || selectedStreak >= 2;
  }
  if (
    candidate.source === "raw" &&
    selectedStreak >= 2 &&
    bestMisses >= 3 &&
    candidate.text.length >= 3
  ) {
    return score >= bestScore - 4;
  }
  if (
    candidate.source === "raw" &&
    sharedPrefixLength < 2 &&
    selectedStreak >= 2 &&
    seenCount >= 2 &&
    bestMisses >= 4 &&
    candidate.text.length >= Math.min(4, best.text.length)
  ) {
    return score >= bestScore - 6;
  }
  if (
    candidate.source === "raw" &&
    sharedPrefixLength >= 3 &&
    candidate.text.length >= best.text.length + 2
  ) {
    return score >= bestScore - 1.5 || seenCount >= 2;
  }
  if (
    candidate.source === "raw" &&
    seenCount >= 2 &&
    candidate.text.length >= 3 &&
    candidate.text.length >= best.text.length - 1
  ) {
    return score >= bestScore - 3;
  }
  if (
    candidate.source.startsWith("alt") &&
    candidate.text.startsWith(best.text) &&
    candidate.text.length > best.text.length
  ) {
    return selectedStreak >= 4 && score >= bestScore + 3;
  }
  if (candidate.text.startsWith(best.text)) {
    return score >= bestScore - 1.2;
  }
  if (
    best.text.startsWith(candidate.text) &&
    best.text.length - candidate.text.length <= 2 &&
    seenCount >= 2
  ) {
    return score >= bestScore - 1;
  }
  if (
    sharedPrefixLength >= 4 &&
    Math.abs(candidate.text.length - best.text.length) <= 3
  ) {
    return score >= bestScore - 0.8;
  }
  return score >= bestScore + 0.25;
}

function isSuspiciousAlternativeTail(
  source: string,
  text: string,
  primaryText: string,
  greedyText: string,
) {
  if (!source.startsWith("alt")) return false;
  if (greedyText && text.startsWith(greedyText)) {
    const extra = text.length - greedyText.length;
    if (extra > 0 && extra <= 2) return true;
  }
  if (primaryText && text.startsWith(primaryText)) {
    const extra = text.length - primaryText.length;
    if (extra > 0 && extra <= 2) return true;
  }
  return false;
}

function cleanPredictionText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scorePredictionCandidate(
  rawText: string,
  text: string,
  confidence: number,
  previousBestText: string,
  primaryText: string,
  greedyText: string,
  source: string,
) {
  const punctuationPenalty = rawText.replace(/[a-z0-9 ]/gi, "").length * 0.5;
  const repeatedTailPenalty = /(.)\1$/u.test(text) ? 0.25 : 0;
  const shortFragmentPenalty =
    text.length <= 3 && text.includes(" ") ? 0.75 : 0;
  const singleCharacterBonus = /^[a-z0-9]$/u.test(text) ? 0.35 : 0;
  const primaryBonus = source === "raw" ? 0.75 : 0;
  const greedyBonus = source === "greedy" ? 0.55 : 0;
  const alternativePenalty = source.startsWith("alt") ? 0.8 : 0;
  const alternativeTailPenalty =
    source.startsWith("alt") &&
    primaryText.length >= 3 &&
    text.startsWith(primaryText) &&
    text.length - primaryText.length <= 2
      ? 1.4
      : 0;
  const alternativeBestExtensionPenalty =
    source.startsWith("alt") &&
    previousBestText.length >= 3 &&
    text.startsWith(previousBestText) &&
    text.length > previousBestText.length
      ? 3.6
      : 0;
  const greedyAgreementBonus =
    greedyText &&
    text === greedyText &&
    (source === "raw" || source === "greedy")
      ? 0.7
      : 0;
  const prefixLength = commonPrefixLength(text, previousBestText);
  const extensionBonus =
    source === "raw" &&
    previousBestText.length >= 3 &&
    text.startsWith(previousBestText)
      ? 1.1
      : 0;
  const tailCorrectionBonus =
    text.length >= 4 &&
    previousBestText.startsWith(text) &&
    previousBestText.length - text.length <= 2
      ? 0.65
      : 0;
  const prefixRegressionPenalty =
    previousBestText.length >= 4 && prefixLength < 3 ? 2.5 : 0;
  return (
    confidence * 2 +
    Math.min(text.length, 14) * 0.08 +
    primaryBonus +
    greedyBonus +
    greedyAgreementBonus +
    extensionBonus +
    tailCorrectionBonus -
    punctuationPenalty -
    alternativePenalty -
    alternativeTailPenalty -
    alternativeBestExtensionPenalty -
    repeatedTailPenalty -
    shortFragmentPenalty +
    singleCharacterBonus -
    prefixRegressionPenalty
  );
}

function commonPrefixLength(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}
