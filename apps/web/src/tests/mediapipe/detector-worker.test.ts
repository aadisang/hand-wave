import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandDetectorApi } from "@/types/landmarks";

const mocks = vi.hoisted(() => ({
  exposed: null as HandDetectorApi | null,
  created: [] as string[],
  handResults: [] as Array<{
    landmarks: Array<Array<Record<string, number>>>;
    handedness: Array<Array<{ categoryName: string }>>;
  }>,
}));

vi.mock("comlink", () => ({
  expose: (api: HandDetectorApi) => {
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
    mocks.handResults = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("var ModuleFactory = () => Promise.resolve({});"),
      ),
    );
  });

  it("installs the WASM factory for the hand task", async () => {
    await import("@/lib/mediapipe/detector-worker");

    expect(mocks.exposed).not.toBeNull();
    await mocks.exposed?.warm();

    expect(mocks.created).toEqual(["hand"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns hand results without waiting for pose detection", async () => {
    const hand = Array.from({ length: 21 }, (_, index) => ({
      x: index / 100,
      y: index / 100,
      z: 0,
    }));
    mocks.handResults = [
      {
        landmarks: [hand],
        handedness: [[{ categoryName: "Left" }]],
      },
    ];
    await import("@/lib/mediapipe/detector-worker");
    await mocks.exposed?.warm();

    const image = fakeImage();
    const result = await mocks.exposed?.detect({
      image,
      timestamp: 100,
    });

    expect(result?.frame.rightHandLandmarks).toEqual([hand]);
    expect(result?.frame.leftHandLandmarks).toEqual([]);
    expect(image.close).toHaveBeenCalledOnce();
  });
});

function consumeModuleFactory(task: string) {
  const worker = globalThis as typeof globalThis & {
    ModuleFactory?: () => Promise<unknown>;
  };
  if (!worker.ModuleFactory) throw new Error("ModuleFactory not set.");
  delete worker.ModuleFactory;
  mocks.created.push(task);
  return {
    detectForVideo: () =>
      mocks.handResults.shift() ?? { landmarks: [], handedness: [] },
  };
}

function fakeImage() {
  return new FakeImageBitmap();
}

class FakeImageBitmap implements ImageBitmap {
  readonly width = 640;
  readonly height = 480;
  readonly close = vi.fn();
}
