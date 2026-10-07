import type { Frame } from "@/types/inference";

export type LocalModelOutput = {
  columns: number;
  frameConfidence: number;
  rows: number;
  values: Float32Array;
};

export type LocalModelWorker = {
  prepare: () => Promise<void>;
  infer: (frames: Frame[]) => Promise<LocalModelOutput>;
};
