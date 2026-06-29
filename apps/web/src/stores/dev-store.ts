import { create } from "zustand";
import type { DevState } from "@/types/dev";
import type { HandFrame } from "@/types/landmarks";

const ema = (prev: number, next: number) =>
  prev ? prev * 0.85 + next * 0.15 : next;

const maxTraces = 5000;
const maxFrameTraces = 1200;
const maxRecordings = 120;
const panelUpdateMs = 250;
let lastAt = 0;
let lastPanelAt = 0;
let pendingFrame: HandFrame | null = null;
let pendingInferenceMs = 0;
let pendingFps: number | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingPanelUpdate() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingFrame = null;
  pendingInferenceMs = 0;
  pendingFps = null;
}

export const useDevStore = create<DevState>((set) => ({
  enabled: false,
  boundary: 0,
  frame: null,
  fps: 0,
  inferenceMs: 0,
  traces: [],
  recording: null,
  recordings: [],
  toggle: () => {
    clearPendingPanelUpdate();
    set((s) => ({ enabled: !s.enabled, frame: null, fps: 0, inferenceMs: 0 }));
  },
  push: (frame, ms) => {
    const now = performance.now();
    const dt = lastAt ? now - lastAt : 0;
    lastAt = now;
    pendingFrame = frame;
    pendingInferenceMs = ms;
    pendingFps = dt ? 1000 / dt : null;

    const commit = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      lastPanelAt = performance.now();
      const nextFrame = pendingFrame;
      const nextInferenceMs = pendingInferenceMs;
      const nextFps = pendingFps;
      set((s) => ({
        frame: nextFrame,
        inferenceMs: ema(s.inferenceMs, nextInferenceMs),
        fps: nextFps ? ema(s.fps, nextFps) : s.fps,
      }));
    };

    const elapsed = now - lastPanelAt;
    if (elapsed >= panelUpdateMs) {
      commit();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(commit, panelUpdateMs - elapsed);
    }
  },
  pushTrace: (trace) =>
    set((s) => ({ traces: [...s.traces, trace].slice(-maxTraces) })),
  startRecording: (label) =>
    set({
      recording: {
        id: new Date().toISOString().replace(/[:.]/g, "-"),
        label: label.trim() || "unlabeled",
        startedAt: new Date().toISOString(),
        frames: [],
      },
    }),
  stopRecording: () =>
    set((s) => {
      if (!s.recording) return s;
      return {
        recording: null,
        recordings: [...s.recordings, s.recording].slice(-maxRecordings),
      };
    }),
  resetTraceCapture: () => set({ traces: [], recording: null, recordings: [] }),
  markBoundary: () => set((s) => ({ boundary: s.boundary + 1 })),
  pushFrameTrace: (trace) =>
    set((s) => {
      if (!s.recording) return s;
      const lastFrame = s.recording.frames.at(-1);
      const nextIndex = lastFrame ? lastFrame.index + 1 : 0;
      return {
        recording: {
          ...s.recording,
          frames: [
            ...s.recording.frames,
            {
              ...trace,
              index: nextIndex,
              atMs: performance.now(),
            },
          ].slice(-maxFrameTraces),
        },
      };
    }),
}));
