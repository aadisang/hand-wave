import { inferenceConfig } from "@/config/inference";
import type { Prediction as DetectionPrediction } from "@/types/detections";
import type { LandmarkFrame, StreamPrediction } from "@/types/inference";

export const {
  finalizedDisplayMs,
  idleFramesToFinalize,
  minDecodeFrames,
  motionThreshold,
  strideFrames,
} = inferenceConfig.stream;

const minFrameIntervalMs = 1_000 / inferenceConfig.stream.targetFps;

type CandidateInput = {
  source: string;
  rawText: string;
  confidence: number;
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
};

export type DecodeTrace = {
  bufferedFrames: number;
  rawLabel: string;
  partialText: string;
  greedyText: string;
  selectedText: string;
  selectedSource: string;
  selectedConfidence: number;
  displayText: string;
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
  displayScore: number;
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
  const counts = new Map<string, number>();

  const reset = () => {
    display = null;
    selectedText = "";
    selectedStreak = 0;
    displayMisses = 0;
    counts.clear();
  };

  const accept = (
    response: StreamPrediction,
    context: DecodeContext,
  ): ArbitrationUpdate => {
    const rawLabel = response.prediction.label.trim();
    const partialText = response.partial_text.trim();
    const greedyText = response.greedy_text.trim();
    const candidate = selectCandidate(
      response,
      rawLabel,
      partialText,
      greedyText,
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
      const misses =
        display && candidate.text !== display.prediction.text
          ? displayMisses + 1
          : 0;
      if (
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
        display = { prediction, score };
        displayMisses = 0;
      } else {
        displayMisses = misses;
      }
    }

    const visible = display?.prediction ?? prediction;
    return {
      displayPrediction: visible ? toDisplayPrediction(visible) : null,
      trace: {
        bufferedFrames: response.buffered_frames,
        rawLabel,
        partialText,
        greedyText,
        selectedText: candidate?.text ?? "",
        selectedSource: candidate?.source ?? "",
        selectedConfidence: candidate?.confidence ?? 0,
        displayText: display?.prediction.text ?? "",
        idleFrames: context.idleFrames,
        motion: context.motion,
        latencyMs: context.latencyMs,
      },
    };
  };

  const finalize = (idleFrames: number): FinalizedPrediction => {
    const prediction = display?.prediction ?? null;
    const seenCount = prediction ? (counts.get(prediction.text) ?? 0) : 0;
    const committed = prediction
      ? shouldCommitPrediction(prediction, seenCount)
      : false;

    return {
      displayPrediction: prediction ? toDisplayPrediction(prediction) : null,
      committed,
      trace: {
        text: prediction?.text ?? "",
        displayText: prediction ? formatPredictionText(prediction.text) : "",
        confidence: prediction?.confidence ?? 0,
        seenCount,
        committed,
        idleFrames,
        displayScore: display?.score ?? 0,
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
  greedyText: string,
  previousDisplayText: string,
) {
  const raw = cleanPredictionText(rawLabel);
  const greedy = cleanPredictionText(greedyText);
  const inputs: CandidateInput[] = [
    {
      source: "partial",
      rawText: partialText,
      confidence: response.prediction.confidence,
    },
    {
      source: "raw",
      rawText: rawLabel,
      confidence: response.prediction.confidence,
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
    })),
  ];

  return inputs.reduce<Candidate | null>((best, input) => {
    const text = cleanPredictionText(input.rawText);
    if (!text || isSuspiciousAlternativeTail(input.source, text, raw, greedy)) {
      return best;
    }

    const candidate = {
      ...input,
      text,
      score: scoreCandidate(input, text, previousDisplayText, raw, greedy),
    };
    return !best || candidate.score > best.score ? candidate : best;
  }, null);
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

function shouldReplace(
  candidate: Candidate,
  score: number,
  seenCount: number,
  streak: number,
  misses: number,
  context: DecodeContext,
  display: ScoredPrediction | null,
) {
  if (!display) return true;

  const current = display.prediction.text;
  const shared = commonPrefixLength(candidate.text, current);
  const isOneCharTail =
    current.length >= 4 &&
    candidate.text.startsWith(current) &&
    candidate.text.length === current.length + 1;

  if (isOneCharTail) {
    return (
      candidate.source === "raw" &&
      seenCount >= 3 &&
      streak >= 3 &&
      score >= display.score + (context.idleFrames > 0 ? 2.2 : 1.25)
    );
  }

  if (candidate.source === "greedy" && shared >= 3) {
    return streak >= 2 || score >= display.score - 2;
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

function isSuspiciousAlternativeTail(
  source: string,
  text: string,
  raw: string,
  greedy: string,
) {
  if (!source.startsWith("alt")) return false;
  return [raw, greedy].some((base) => {
    const extra = text.length - base.length;
    return base && text.startsWith(base) && extra > 0 && extra <= 2;
  });
}

function cleanPredictionText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(
  input: CandidateInput,
  text: string,
  previous: string,
  raw: string,
  greedy: string,
) {
  const { source, confidence, rawText } = input;
  const punctuationPenalty = rawText.replace(/[a-z0-9 ]/gi, "").length * 0.5;
  const primaryBonus = source === "raw" ? 0.75 : 0;
  const greedyBonus = source === "greedy" ? 0.55 : 0;
  const altPenalty = source.startsWith("alt") ? 0.8 : 0;
  const agreementBonus =
    greedy && text === greedy && (source === "raw" || source === "greedy")
      ? 0.7
      : 0;
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
    Math.min(text.length, 14) * 0.08 +
    primaryBonus +
    greedyBonus +
    agreementBonus +
    extensionBonus +
    tailFixBonus +
    (/^[a-z0-9]$/u.test(text) ? 0.35 : 0) -
    punctuationPenalty -
    altPenalty -
    altTailPenalty -
    (/(.)\1$/u.test(text) ? 0.25 : 0) -
    (text.length <= 3 && text.includes(" ") ? 0.75 : 0) -
    (previous.length >= 4 && commonPrefixLength(text, previous) < 3 ? 2.5 : 0)
  );
}

function commonPrefixLength(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return n;
}
