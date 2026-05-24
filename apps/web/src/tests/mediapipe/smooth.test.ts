import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createSmoother } from "@/lib/mediapipe/smooth";
import type { HandFrame } from "@/types/landmarks";

describe("createSmoother", () => {
  it("keeps hands more responsive than pose", () => {
    const smoother = createSmoother();

    smoother.smooth(frame(point(0.5)), 0);
    const smoothed = smoother.smooth(frame(point(0.6)), 16);
    const handX = smoothed.rightHandLandmarks[0]?.[0]?.x ?? 0;
    const poseX = smoothed.poseLandmarks[0]?.[0]?.x ?? 0;

    expect(handX).toBeGreaterThan(poseX);
    expect(handX).toBeLessThan(0.6);
    expect(poseX).toBeGreaterThan(0.5);
  });

  it("drops stale hand state when MediaPipe loses the hand", () => {
    const smoother = createSmoother();

    smoother.smooth(frame(point(0.5)), 0);
    const smoothed = smoother.smooth(
      {
        rightHandLandmarks: [],
        leftHandLandmarks: [],
        poseLandmarks: [landmarks(33, point(0.5))],
      },
      16,
    );

    expect(smoothed.rightHandLandmarks).toEqual([]);
  });
});

function frame(landmark: NormalizedLandmark): HandFrame {
  return {
    rightHandLandmarks: [landmarks(21, landmark)],
    leftHandLandmarks: [],
    poseLandmarks: [landmarks(33, landmark)],
  };
}

function landmarks(count: number, landmark: NormalizedLandmark) {
  return Array.from({ length: count }, () => ({ ...landmark }));
}

function point(x: number) {
  return { x, y: 0.5, z: 0, visibility: 1 };
}
