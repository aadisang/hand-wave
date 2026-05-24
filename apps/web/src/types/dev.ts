import type { HandFrame } from "@/types/landmarks";
import type { DecodeTrace, FinalizeTrace } from "@/types/inference";

export type DevTrace = DecodeTrace | FinalizeTrace;

export type DevState = {
  enabled: boolean;
  frame: HandFrame | null;
  fps: number;
  inferenceMs: number;
  traces: DevTrace[];
  toggle: () => void;
  push: (frame: HandFrame, inferenceMs: number) => void;
  pushTrace: (trace: DevTrace) => void;
};
