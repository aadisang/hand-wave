import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LandmarkDetectorApi } from "@/types/landmarks";

const mocks = vi.hoisted(() => ({
  exposed: null as LandmarkDetectorApi | null,
  created: [] as string[],
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
    smooth: vi.fn(),
  }),
}));

describe("MediaPipe detector worker", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.exposed = null;
    mocks.created.length = 0;
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
});

function consumeModuleFactory(task: string) {
  const worker = globalThis as typeof globalThis & {
    ModuleFactory?: () => Promise<unknown>;
  };
  if (!worker.ModuleFactory) throw new Error("ModuleFactory not set.");
  delete worker.ModuleFactory;
  mocks.created.push(task);
  return {};
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
