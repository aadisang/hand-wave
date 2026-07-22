import { cfg } from "@hand-wave/contract";
import type { Frame } from "@/types/inference";

export const { window: maxFrames } = cfg.decode;
const frameMs = 1_000 / cfg.stream.fps;

function scaledMs(value: number) {
  return value * frameMs;
}

export function streamTiming() {
  return {
    holdMs: cfg.stream.holdMs,
    idle: cfg.stream.idle,
    idleMs: scaledMs(cfg.stream.idle),
    lost: cfg.stream.lost,
    lostMs: scaledMs(cfg.stream.lost),
    maxFrames: cfg.decode.window,
    minFrames: cfg.stream.min,
    minMs: scaledMs(cfg.stream.min),
    motionMin: cfg.stream.motion,
    sampleMs: frameMs,
    stride: cfg.stream.stride,
    strideMs: scaledMs(cfg.stream.stride),
    stallMs: cfg.stream.holdMs / 2,
  };
}

export function interpolateFrame(from: Frame, to: Frame, progress: number) {
  const amount = Math.min(1, Math.max(0, progress));
  return from.map((value, index) => value + (to[index] - value) * amount);
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
