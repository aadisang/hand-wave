import { cfg } from "@hand-wave/contract";
import type { Frame } from "@/types/inference";

export const { window: maxFrames } = cfg.decode;
const maxWireFrames = 512;
const maxInferenceFrameRate = 60;
const frameMs = 1_000 / cfg.stream.fps;

export function effectiveFrameRate(frameRate = cfg.stream.fps) {
  return Math.min(Math.max(frameRate, cfg.stream.fps), maxInferenceFrameRate);
}

function scaledMs(value: number) {
  return value * frameMs;
}

function scaledFrames(value: number, frameRate: number) {
  return Math.max(1, Math.ceil((value * frameRate) / cfg.stream.fps));
}

export function streamTiming(frameRate = cfg.stream.fps) {
  const fps = effectiveFrameRate(frameRate);
  return {
    holdMs: cfg.stream.holdMs,
    idle: scaledFrames(cfg.stream.idle, fps),
    idleMs: scaledMs(cfg.stream.idle),
    lost: scaledFrames(cfg.stream.lost, fps),
    lostMs: scaledMs(cfg.stream.lost),
    maxFrames: Math.min(maxWireFrames, scaledFrames(cfg.decode.window, fps)),
    minFrames: scaledFrames(cfg.stream.min, fps),
    minMs: scaledMs(cfg.stream.min),
    motionMin: cfg.stream.motion,
    stride: scaledFrames(cfg.stream.stride, fps),
    strideMs: scaledMs(cfg.stream.stride),
    stallMs: cfg.stream.holdMs / 2,
  };
}

export const { holdMs, idle, lost, minFrames, motionMin, stride } =
  streamTiming();

export function acceptedFrameTime(
  lastAcceptedFrameMs: number,
  frameRate = cfg.stream.fps,
) {
  const timestampMs = performance.now();
  const minFrameMs = 1_000 / effectiveFrameRate(frameRate);
  return timestampMs - lastAcceptedFrameMs < minFrameMs ? null : timestampMs;
}

export function frameMotion(previous: Frame | null, current: Frame) {
  if (!previous) return 0;
  const count = Math.min(21, previous.length / 3, current.length / 3);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    total +=
      Math.abs(previous[offset] - current[offset]) +
      Math.abs(previous[offset + 1] - current[offset + 1]);
  }
  return total / count;
}
