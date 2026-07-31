import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoseDetectorApi } from "@/types/landmarks";

const mocks = vi.hoisted(() => ({
  exposed: null as PoseDetectorApi | null,
  created: 0,
  poseResults: [] as Array<{ landmarks: Array<Array<Record<string, number>>> }>,
}));

vi.mock("comlink", () => ({
  expose: (api: PoseDetectorApi) => {
    mocks.exposed = api;
  },
}));

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn(async () => ({
      wasmLoaderPath: "https://example.com/vision.js",
      wasmBinaryPath: "https://example.com/vision.wasm",
    })),
  },
  PoseLandmarker: {
    createFromOptions: vi.fn(async () => {
      consumeModuleFactory();
      return {
        detectForVideo: () => mocks.poseResults.shift() ?? { landmarks: [] },
      };
    }),
  },
}));

vi.mock("@/lib/mediapipe/console", () => ({
  filterConsole: vi.fn(),
}));

vi.mock("@/lib/mediapipe/smooth", () => ({
  createSmoother: () => ({
    reset: vi.fn(),
    smooth: vi.fn((frame) => frame),
  }),
}));

describe("MediaPipe pose worker", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.exposed = null;
    mocks.created = 0;
    mocks.poseResults = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("var ModuleFactory = () => Promise.resolve({});"),
      ),
    );
  });

  it("runs pose detection apart from the hand worker", async () => {
    await import("@/lib/mediapipe/pose-worker");

    expect(mocks.exposed).not.toBeNull();
    await mocks.exposed?.warm();
    expect(mocks.created).toBe(1);
  });

  it("reuses the last good pose through a short detector miss", async () => {
    const pose = Array.from({ length: 33 }, (_, index) => ({
      x: index / 100,
      y: index / 100,
      z: 0,
    }));
    mocks.poseResults = [{ landmarks: [pose] }, { landmarks: [] }];
    await import("@/lib/mediapipe/pose-worker");
    await mocks.exposed?.warm();

    const first = await mocks.exposed?.detect({
      image: fakeImage(),
      timestamp: 100,
    });
    const second = await mocks.exposed?.detect({
      image: fakeImage(),
      timestamp: 200,
    });

    expect(first?.poseLandmarks).toEqual([pose]);
    expect(second?.poseLandmarks).toEqual([pose]);
  });
});

function consumeModuleFactory() {
  const worker = globalThis as typeof globalThis & {
    ModuleFactory?: () => Promise<unknown>;
  };
  if (!worker.ModuleFactory) throw new Error("ModuleFactory not set.");
  delete worker.ModuleFactory;
  mocks.created += 1;
}

function fakeImage() {
  return new FakeImageBitmap();
}

class FakeImageBitmap implements ImageBitmap {
  readonly width = 640;
  readonly height = 480;
  readonly close = vi.fn();
}
