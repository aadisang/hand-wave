import type {
  HandLandmarker,
  NormalizedLandmark,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type { OneEuroFilter } from "1eurofilter";

export type Trackers = {
  hand: HandLandmarker;
  pose: PoseLandmarker;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

export type HandSide = "Left" | "Right";

export type HandFrame = {
  rightHandLandmarks: NormalizedLandmark[][];
  leftHandLandmarks: NormalizedLandmark[][];
  poseLandmarks: NormalizedLandmark[][];
};

export type FrameSink = (frame: HandFrame, inferenceMs: number) => void;

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
