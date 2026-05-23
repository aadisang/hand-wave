import type {
  HealthResponseSchema,
  LandmarkFrameSchema,
  PredictionSchema,
  PredictionSpanSchema,
  StreamPredictionSchema,
} from "@/lib/inference/schemas";
import type { Prediction as DetectionPrediction } from "@/types/detections";

export type LandmarkFrame = typeof LandmarkFrameSchema.Type;
export type HealthResponse = typeof HealthResponseSchema.Type;
export type Prediction = typeof PredictionSchema.Type;
export type PredictionSpan = typeof PredictionSpanSchema.Type;
export type StreamPrediction = typeof StreamPredictionSchema.Type;

export type CandidateSource = "partial" | "raw" | `alt ${number}`;
export type PredictionTextKind =
  | "letter"
  | "short"
  | "phrase"
  | "long"
  | "word";

export type DecodeContext = {
  latencyMs: number;
  idleFrames: number;
  motion: number;
};

export type Candidate = {
  source: CandidateSource;
  rawText: string;
  text: string;
  confidence: number;
  lmScore: number | null;
  modelAgrees: boolean;
  score: number;
};

export type ScoredPrediction = {
  prediction: DetectionPrediction;
  score: number;
  source: CandidateSource;
  lmScore: number | null;
  modelAgrees: boolean;
  streak: number;
};

export type CandidateInput = Omit<Candidate, "score" | "text">;

export type ConfidenceThreshold = {
  instant: number;
  seen: number;
  streak: number;
  confidence: number;
};

export type DisplayDecisionState = {
  context: DecodeContext;
  misses: number;
  seenCount: number;
  score: number;
  streak: number;
};

export type InferenceStreamController = {
  start: () => Promise<void>;
  dispose: () => void;
  accept: (frame: LandmarkFrame | null) => void;
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

export type FinalizeContext = {
  endpointReason: EndpointReason;
  idleFrames: number;
  missingFrames: number;
  segmentFrames: number;
};
