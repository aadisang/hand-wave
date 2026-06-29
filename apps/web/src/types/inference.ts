import type { components } from "@/lib/inference/openapi";
import type { Prediction as DetectionPrediction } from "@/types/detections";

export type Frame = components["schemas"]["LandmarkFrame"];
export type InferOut = components["schemas"]["PredictOut"];
export type RecognizeIn = components["schemas"]["RecognizeIn"];
export type RecognizeOut = components["schemas"]["RecognizeOut"];
export type RecognitionState = components["schemas"]["RecognitionState"];
export type RecognitionContext = components["schemas"]["RecognitionContext"];
export type WirePrediction = components["schemas"]["Prediction"];
export type WireDecodeTrace = components["schemas"]["DecodeTrace"];
export type WireFinalizeTrace = components["schemas"]["FinalizeTrace"];

export type StreamCtrl = {
  start: () => void;
  reset: () => void;
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

export type PredictTrace = {
  type: "predict";
  at: string;
  frames: number;
  idleFrames: number;
  motion: number;
  latencyMs: number;
  prediction: InferOut;
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

export function toDetectionPrediction(
  prediction: WirePrediction | null | undefined,
  processingTimeMs = 0,
): DetectionPrediction | null {
  if (!prediction) return null;
  return {
    text: prediction.label,
    confidence: prediction.confidence,
    processingTimeMs,
  };
}
