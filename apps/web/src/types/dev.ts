import type { CaptureKind } from "@/types/capture";
import type {
  DecodeTrace,
  FinalizeTrace,
  Frame,
  PredictTrace,
} from "@/types/inference";
import type { HandFrame, HandSide } from "@/types/landmarks";

export type DevTrace = DecodeTrace | FinalizeTrace | PredictTrace;

export type DevFrameTrace = {
  index: number;
  atMs: number;
  inferenceMs: number;
  captureKind: CaptureKind;
  selectedHand: HandSide | null;
  rawFrame: HandFrame;
  modelFrame: HandFrame | null;
  features: Frame | null;
};

export type DevRecording = {
  id: string;
  label: string;
  startedAt: string;
  frames: DevFrameTrace[];
};

export type DevState = {
  enabled: boolean;
  boundary: number;
  frame: HandFrame | null;
  fps: number;
  inferenceMs: number;
  traces: DevTrace[];
  recording: DevRecording | null;
  recordings: DevRecording[];
  toggle: () => void;
  push: (frame: HandFrame | null, inferenceMs: number) => void;
  pushTrace: (trace: DevTrace) => void;
  startRecording: (label: string) => void;
  stopRecording: () => void;
  resetTraceCapture: () => void;
  markBoundary: () => void;
  pushFrameTrace: (trace: Omit<DevFrameTrace, "atMs" | "index">) => void;
};
