import type { HandFrame } from "@/types/landmarks";

type PoseLandmarks = HandFrame["poseLandmarks"];

export type PoseSampler = {
  sample: (timestamp: number, detect: () => PoseLandmarks) => PoseLandmarks;
  reset: () => void;
};

// Pose moves slowly relative to hands, so detection runs at a reduced rate and
// the last good pose bridges the gap between samples and short detector misses.
export function createPoseSampler({
  sampleMs,
  reuseMs,
}: {
  sampleMs: number;
  reuseMs: number;
}): PoseSampler {
  let pose: PoseLandmarks = [];
  let poseAt = 0;
  let sampledAt = 0;

  return {
    sample(timestamp, detect) {
      if (pose.length === 0 || timestamp - sampledAt >= sampleMs) {
        sampledAt = timestamp;
        const detected = detect();
        if (detected.length > 0) {
          pose = detected;
          poseAt = timestamp;
        }
      }
      if (pose.length > 0 && timestamp - poseAt > reuseMs) pose = [];
      return pose;
    },
    reset() {
      pose = [];
      poseAt = 0;
      sampledAt = 0;
    },
  };
}
