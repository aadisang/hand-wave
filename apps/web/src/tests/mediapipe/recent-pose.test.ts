import { describe, expect, it } from "vitest";
import { createRecentPose } from "@/lib/mediapipe/recent-pose";

const reuseMs = 500;

const pose = (x: number) => [[{ x, y: 0, z: 0, visibility: 1 }]];

describe("createRecentPose", () => {
  it("drops a stale pose after the reuse window", () => {
    const recentPose = createRecentPose(reuseMs);

    expect(recentPose.update(pose(0.5), 0)).toEqual(pose(0.5));
    expect(recentPose.update([], reuseMs)).toEqual(pose(0.5));
    expect(recentPose.update([], reuseMs + 1)).toEqual([]);
  });
});
