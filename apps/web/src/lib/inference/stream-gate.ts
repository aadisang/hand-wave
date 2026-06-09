import { cfg } from "@hand-wave/contract";
import type { Frame } from "@/types/inference";

export const { window: maxFrames } = cfg.decode;

export const {
  holdMs,
  idle,
  lost,
  min: minFrames,
  motion: motionMin,
  stride,
} = cfg.stream;

const minFrameMs = 1_000 / cfg.stream.fps;

export function acceptedFrameTime(lastAcceptedFrameMs: number) {
  const timestampMs = performance.now();
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
