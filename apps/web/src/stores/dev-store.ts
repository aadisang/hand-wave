import { create } from "zustand";
import { createRateMeter } from "@/lib/rate-meter";
import type { DevState } from "@/types/dev";
import type { HandFrame } from "@/types/landmarks";

const ema = (prev: number, next: number) =>
  prev ? prev * 0.85 + next * 0.15 : next;

const maxTraces = 5000;
const maxFrameTraces = 1200;
const maxRecordings = 120;
const panelUpdateMs = 250;
const fpsSampleMs = 500;
const pipelineRate = createRateMeter(fpsSampleMs);
const poseRate = createRateMeter(fpsSampleMs);
const presentedRate = createRateMeter(fpsSampleMs);
let lastPanelAt = 0;
let pendingFrame: HandFrame | null = null;
let pendingDetectorRoundTripMs = 0;
let pendingInferenceMs = 0;
let pendingPipelineFps: number | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingPanelUpdate() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingFrame = null;
  pendingDetectorRoundTripMs = 0;
  pendingInferenceMs = 0;
  pendingPipelineFps = null;
  pipelineRate.reset();
  poseRate.reset();
  presentedRate.reset();
  lastPanelAt = 0;
}

export const useDevStore = create<DevState>((set) => ({
  enabled: false,
  boundary: 0,
  frame: null,
  pipelineFps: 0,
  poseFps: 0,
  presentedFps: 0,
  detectorRoundTripMs: 0,
  inferenceMs: 0,
  poseRoundTripMs: 0,
  poseInferenceMs: 0,
  traces: [],
  recording: null,
  recordings: [],
  toggle: () => {
    clearPendingPanelUpdate();
    set((s) => ({
      enabled: !s.enabled,
      frame: null,
      pipelineFps: 0,
      poseFps: 0,
      presentedFps: 0,
      detectorRoundTripMs: 0,
      inferenceMs: 0,
      poseRoundTripMs: 0,
      poseInferenceMs: 0,
      ...(s.enabled && s.recording
        ? {
            recording: null,
            recordings: [...s.recordings, s.recording].slice(-maxRecordings),
          }
        : {}),
    }));
  },
  push: (frame, metrics) => {
    const now = performance.now();
    pendingFrame = frame;
    pendingDetectorRoundTripMs = metrics.detectorRoundTripMs;
    pendingInferenceMs = metrics.inferenceMs;
    pendingPipelineFps = pipelineRate.push(now) ?? pendingPipelineFps;

    const commit = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      lastPanelAt = performance.now();
      const nextFrame = pendingFrame;
      const nextDetectorRoundTripMs = pendingDetectorRoundTripMs;
      const nextInferenceMs = pendingInferenceMs;
      const nextPipelineFps = pendingPipelineFps;
      pendingPipelineFps = null;
      set((s) => ({
        frame: nextFrame,
        detectorRoundTripMs: ema(
          s.detectorRoundTripMs,
          nextDetectorRoundTripMs,
        ),
        inferenceMs: ema(s.inferenceMs, nextInferenceMs),
        pipelineFps: nextPipelineFps ?? s.pipelineFps,
      }));
    };

    const elapsed = now - lastPanelAt;
    if (elapsed >= panelUpdateMs) {
      commit();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(commit, panelUpdateMs - elapsed);
    }
  },
  pushPose: (at, metrics) => {
    const poseFps = poseRate.push(at);
    if (poseFps === null) return;
    set((s) => ({
      poseFps,
      poseRoundTripMs: ema(s.poseRoundTripMs, metrics.detectorRoundTripMs),
      poseInferenceMs: ema(s.poseInferenceMs, metrics.inferenceMs),
    }));
  },
  pushPresentedFrames: (frames, at) => {
    const presentedFps = presentedRate.push(at, frames);
    if (presentedFps !== null) set({ presentedFps });
  },
  resetRates: () => {
    clearPendingPanelUpdate();
    set({
      detectorRoundTripMs: 0,
      inferenceMs: 0,
      pipelineFps: 0,
      poseFps: 0,
      presentedFps: 0,
      poseRoundTripMs: 0,
      poseInferenceMs: 0,
    });
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
