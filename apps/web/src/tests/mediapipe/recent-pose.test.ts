import { describe, expect, it } from "vitest";
import { createRecentPose } from "@/lib/mediapipe/recent-pose";

const reuseMs = 500;

const pose = (x: number) => [[{ x, y: 0, z: 0, visibility: 1 }]];

describe("createRecentPose", () => {
  it("keeps the last good pose through a short miss", () => {
    const recentPose = createRecentPose(reuseMs);

    expect(recentPose.update([], 0)).toEqual([]);
    expect(recentPose.update(pose(0.5), 100)).toEqual(pose(0.5));
    expect(recentPose.update([], 200)).toEqual(pose(0.5));
  });

  it("drops a stale pose after the reuse window", () => {
    const recentPose = createRecentPose(reuseMs);

    expect(recentPose.update(pose(0.5), 0)).toEqual(pose(0.5));
    expect(recentPose.update([], reuseMs)).toEqual(pose(0.5));
    expect(recentPose.update([], reuseMs + 1)).toEqual([]);
  });

  it("clears the cached pose on reset", () => {
    const recentPose = createRecentPose(reuseMs);

    recentPose.update(pose(0.5), 0);
    recentPose.reset();

    expect(recentPose.update([], 1)).toEqual([]);
  });
});
