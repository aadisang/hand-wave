import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export type HandSide = "Left" | "Right";

export type HandFrame = {
  rightHandLandmarks: NormalizedLandmark[][];
  leftHandLandmarks: NormalizedLandmark[][];
  poseLandmarks: NormalizedLandmark[][];
};

export type FrameMetrics = {
  detectorRoundTripMs: number;
  inferenceMs: number;
};

export type FrameSink = (frame: HandFrame, metrics: FrameMetrics) => void;

export type DetectionRequest = {
  image: ImageBitmap;
  timestamp: number;
};

export type HandDetectionResult = {
  frame: Pick<HandFrame, "leftHandLandmarks" | "rightHandLandmarks">;
  inferenceMs: number;
};

export type PoseDetectionResult = {
  poseLandmarks: HandFrame["poseLandmarks"];
  inferenceMs: number;
};

export type HandDetectorApi = {
  warm: () => Promise<void>;
  reset: () => void;
  detect: (request: DetectionRequest) => Promise<HandDetectionResult>;
};

export type PoseDetectorApi = {
  warm: () => Promise<void>;
  reset: () => void;
  detect: (request: DetectionRequest) => Promise<PoseDetectionResult>;
};
