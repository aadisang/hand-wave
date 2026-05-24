import type {
  FrameSchema,
  PredSchema,
  SpanSchema,
  StreamPredSchema,
} from "@/lib/inference/schema";
import type { Prediction as DetectionPrediction } from "@/types/detections";

export type Frame = typeof FrameSchema.Type;
export type Pred = typeof PredSchema.Type;
export type Span = typeof SpanSchema.Type;
export type StreamPred = typeof StreamPredSchema.Type;

export type Source = "partial" | "raw" | `alt ${number}`;
export type TextKind =
  | "letter"
  | "short"
  | "phrase"
  | "long"
  | "word";

export type DecodeCtx = {
  latencyMs: number;
  idleFrames: number;
  motion: number;
};

export type Candidate = {
  source: Source;
  rawText: string;
  text: string;
  confidence: number;
  lmScore: number | null;
  modelAgrees: boolean;
  score: number;
};

export type Scored = {
  prediction: DetectionPrediction;
  score: number;
  source: Source;
  lmScore: number | null;
  modelAgrees: boolean;
  streak: number;
};

export type CandidateIn = Omit<Candidate, "score" | "text">;

export type Threshold = {
  instant: number;
  seen: number;
  streak: number;
  confidence: number;
};

export type DecisionState = {
  context: DecodeCtx;
  misses: number;
  seenCount: number;
  score: number;
  streak: number;
};

export type StreamCtrl = {
  start: () => Promise<void>;
  dispose: () => void;
  accept: (frame: Frame | null) => void;
};

export type DecodeTrace = {
  type: "decode";
  at: string;
  bufferedFrames: number;
  inputText: string;
  displayText: string;
  idleFrames: number;
  motion: number;
  latencyMs: number;
};

export type FinalizeTrace = {
  type: "finalize";
  at: string;
  text: string;
  confidence: number;
  committed: boolean;
  endpointReason: EndpointReason;
  segmentFrames: number;
};

export type EndpointReason = "idle" | "landmark-lost";

export type FinalCtx = {
  endpointReason: EndpointReason;
  idleFrames: number;
  missingFrames: number;
  segmentFrames: number;
};

export type ArbiterUpdate = {
  displayPrediction: DetectionPrediction | null;
  trace: Omit<DecodeTrace, "type" | "at">;
};

export type FinalPred = {
  displayPrediction: DetectionPrediction | null;
  committed: boolean;
  trace: Omit<FinalizeTrace, "type" | "at">;
};
