import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { OneEuroFilter } from "1eurofilter";
import type { CaptureKind } from "./capture";

export type HandSide = "Left" | "Right";

export type HandFrame = {
  rightHandLandmarks: NormalizedLandmark[][];
  leftHandLandmarks: NormalizedLandmark[][];
  poseLandmarks: NormalizedLandmark[][];
};

export type FrameSink = (frame: HandFrame, inferenceMs: number) => void;

export type LandmarkDetectionRequest = {
  image: ImageBitmap;
  timestamp: number;
  captureKind: CaptureKind;
};

export type LandmarkDetectionResult = {
  frame: HandFrame;
  inferenceMs: number;
};

export type LandmarkDetectorApi = {
  warm: () => Promise<void>;
  detect: (
    request: LandmarkDetectionRequest,
  ) => Promise<LandmarkDetectionResult>;
};

export type Filters = {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
};

export type SmoothParams = {
  freq: number;
  cutoff: number;
  beta: number;
  dCutoff: number;
};
