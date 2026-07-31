import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { createSmoother } from "@/lib/mediapipe/smooth";

describe("createSmoother", () => {
  it("keeps hands more responsive than pose", () => {
    const hand = createSmoother("hand");
    const pose = createSmoother("pose");

    hand.smooth([landmarks(21, point(0.5))], 0);
    pose.smooth([landmarks(33, point(0.5))], 0);
    const handX = hand.smooth([landmarks(21, point(0.6))], 16)[0]?.[0]?.x ?? 0;
    const poseX = pose.smooth([landmarks(33, point(0.6))], 16)[0]?.[0]?.x ?? 0;

    expect(handX).toBeGreaterThan(poseX);
    expect(handX).toBeLessThan(0.6);
    expect(poseX).toBeGreaterThan(0.5);
  });

  it("drops stale state when MediaPipe loses the landmarks", () => {
    const smoother = createSmoother("hand");

    smoother.smooth([landmarks(21, point(0.5))], 0);
    expect(smoother.smooth([], 16)).toEqual([]);
    const reacquired = smoother.smooth([landmarks(21, point(0.6))], 32);

    expect(reacquired[0]?.[0]?.x).toBe(0.6);
  });
});

function landmarks(count: number, landmark: NormalizedLandmark) {
  return Array.from({ length: count }, () => ({ ...landmark }));
}

function point(x: number) {
  return { x, y: 0.5, z: 0, visibility: 1 };
}
