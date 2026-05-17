import type {
  HealthResponseSchema,
  LandmarkFrameSchema,
  PredictionSchema,
  PredictionSpanSchema,
  StreamPredictionSchema,
} from "@/lib/inference/schemas";

export type LandmarkFrame = typeof LandmarkFrameSchema.Type;
export type HealthResponse = typeof HealthResponseSchema.Type;
export type Prediction = typeof PredictionSchema.Type;
export type PredictionSpan = typeof PredictionSpanSchema.Type;
export type StreamPrediction = typeof StreamPredictionSchema.Type;
