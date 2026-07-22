import { describe, expect, it, vi } from "vitest";
import { createPoseSampler } from "@/lib/mediapipe/pose-sampler";

const sampleMs = 100;
const reuseMs = 500;

const pose = (x: number) => [[{ x, y: 0, z: 0, visibility: 1 }]];

describe("createPoseSampler", () => {
  it("samples every frame until a pose is found, then throttles", () => {
    const sampler = createPoseSampler({ sampleMs, reuseMs });
    const detect = vi.fn(() => pose(0.5));
    const miss = vi.fn(() => []);

    expect(sampler.sample(0, miss)).toEqual([]);
    expect(sampler.sample(10, miss)).toEqual([]);
    expect(sampler.sample(20, detect)).toEqual(pose(0.5));
    expect(sampler.sample(30, detect)).toEqual(pose(0.5));

    expect(miss).toHaveBeenCalledTimes(2);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("reuses the last good pose through short misses and drops stale ones", () => {
    const sampler = createPoseSampler({ sampleMs, reuseMs });
    const miss = () => [];

    expect(sampler.sample(0, () => pose(0.5))).toEqual(pose(0.5));
    expect(sampler.sample(sampleMs, miss)).toEqual(pose(0.5));
    expect(sampler.sample(reuseMs, miss)).toEqual(pose(0.5));
    expect(sampler.sample(reuseMs + sampleMs, miss)).toEqual([]);
  });

  it("forgets the held pose on reset", () => {
    const sampler = createPoseSampler({ sampleMs, reuseMs });

    expect(sampler.sample(0, () => pose(0.5))).toEqual(pose(0.5));
    sampler.reset();
    expect(sampler.sample(10, () => [])).toEqual([]);
  });
});
