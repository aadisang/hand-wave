import { create } from "zustand";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";

type State = {
  enabled: boolean;
  frame: HandLandmarksFrame | null;
  fps: number;
  inferenceMs: number;
  toggle: () => void;
  push: (frame: HandLandmarksFrame, inferenceMs: number) => void;
};

const ema = (prev: number, next: number) =>
  prev ? prev * 0.85 + next * 0.15 : next;

let lastAt = 0;

export const useDevStore = create<State>((set) => ({
  enabled: false,
  frame: null,
  fps: 0,
  inferenceMs: 0,
  toggle: () =>
    set((s) => ({ enabled: !s.enabled, frame: null, fps: 0, inferenceMs: 0 })),
  push: (frame, ms) => {
    const now = performance.now();
    const dt = lastAt ? now - lastAt : 0;
    lastAt = now;
    set((s) => ({
      frame,
      inferenceMs: ema(s.inferenceMs, ms),
      fps: dt ? ema(s.fps, 1000 / dt) : s.fps,
    }));
  },
}));
