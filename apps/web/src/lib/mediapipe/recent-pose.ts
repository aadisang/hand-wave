import type { HandFrame } from "@/types/landmarks";

type PoseLandmarks = HandFrame["poseLandmarks"];

type RecentPose = {
  update: (detected: PoseLandmarks, timestamp: number) => PoseLandmarks;
  reset: () => void;
};

export function createRecentPose(reuseMs: number): RecentPose {
  let pose: PoseLandmarks = [];
  let poseAt = 0;

  return {
    update(detected, timestamp) {
      if (detected.length > 0) {
        pose = detected;
        poseAt = timestamp;
      }
      if (pose.length > 0 && timestamp - poseAt > reuseMs) pose = [];
      return pose;
    },
    reset() {
      pose = [];
      poseAt = 0;
    },
  };
}
