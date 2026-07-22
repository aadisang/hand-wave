import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LandmarkDetectorApi } from "@/types/landmarks";

const mocks = vi.hoisted(() => ({
  exposed: null as LandmarkDetectorApi | null,
  created: [] as string[],
  poseResults: [] as Array<{ landmarks: Array<Array<Record<string, number>>> }>,
}));

vi.mock("comlink", () => ({
  expose: (api: LandmarkDetectorApi) => {
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
  HandLandmarker: {
    createFromOptions: vi.fn(async () => consumeModuleFactory("hand")),
  },
  PoseLandmarker: {
    createFromOptions: vi.fn(async () => consumeModuleFactory("pose")),
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

describe("MediaPipe detector worker", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.exposed = null;
    mocks.created.length = 0;
    mocks.poseResults = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("var ModuleFactory = () => Promise.resolve({});"),
      ),
    );
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  });

  it("installs a fresh WASM factory for each MediaPipe task", async () => {
    await import("@/lib/mediapipe/detector-worker");

    expect(mocks.exposed).not.toBeNull();
    await mocks.exposed?.warm();

    expect(mocks.created).toEqual(["hand", "pose"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses the last good pose through a short detector miss", async () => {
    const pose = Array.from({ length: 33 }, (_, index) => ({
      x: index / 100,
      y: index / 100,
      z: 0,
    }));
    mocks.poseResults = [{ landmarks: [pose] }, { landmarks: [] }];
    await import("@/lib/mediapipe/detector-worker");
    await mocks.exposed?.warm();

    const first = await mocks.exposed?.detect({
      image: fakeImage(),
      timestamp: 100,
    });
    const second = await mocks.exposed?.detect({
      image: fakeImage(),
      timestamp: 200,
    });

    expect(first?.frame.poseLandmarks).toEqual([pose]);
    expect(second?.frame.poseLandmarks).toEqual([pose]);
  });
});

function consumeModuleFactory(task: string) {
  const worker = globalThis as typeof globalThis & {
    ModuleFactory?: () => Promise<unknown>;
  };
  if (!worker.ModuleFactory) throw new Error("ModuleFactory not set.");
  delete worker.ModuleFactory;
  mocks.created.push(task);
  if (task === "hand") {
    return {
      detectForVideo: () => ({ landmarks: [], handedness: [] }),
    };
  }
  return {
    detectForVideo: () => mocks.poseResults.shift() ?? { landmarks: [] },
  };
}

function fakeImage() {
  return {
    width: 640,
    height: 480,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

class FakeOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      drawImage: vi.fn(),
      setTransform: vi.fn(),
    };
  }
}
