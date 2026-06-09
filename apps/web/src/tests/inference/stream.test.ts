import { beforeEach, describe, expect, test, vi } from "vitest";
import { createStreamCtrl } from "@/lib/inference/stream";
import { lost, minFrames, stride } from "@/lib/inference/stream-gate";
import { useDetectionsStore } from "@/stores/detections-store";
import type { Frame, RecognizeIn, RecognizeOut } from "@/types/inference";

const inference = vi.hoisted(() => ({
  recognize: vi.fn<(payload: RecognizeIn) => Promise<RecognizeOut>>(),
  warm: vi.fn(),
}));

vi.mock("@/lib/inference/client", () => ({
  recognizeFrames: vi.fn((payload: RecognizeIn) => payload),
  run: vi.fn((payload: RecognizeIn) => inference.recognize(payload)),
  warmInference: inference.warm,
}));

describe("stream controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("window", globalThis);
    useDetectionsStore.setState({ currentPrediction: null });
    inference.recognize.mockReset();
    inference.warm.mockReset();

    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      now += 1_000;
      return now;
    });
  });

  test("preserves a decode response after landmarks disappear", async () => {
    const decode = deferred<RecognizeOut>();
    inference.recognize.mockImplementation((payload) =>
      payload.finalize
        ? Promise.resolve(response("cat", true))
        : decode.promise,
    );

    const controller = createStreamCtrl();
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride + 4);
    }

    for (let index = 0; index < lost + 2; index += 1) {
      controller.accept(null);
    }

    expect(inference.recognize).toHaveBeenCalledTimes(1);
    expect(useDetectionsStore.getState().currentPrediction).toBeNull();

    decode.resolve(response("cat", false));
    await flushPromises();

    expect(useDetectionsStore.getState().currentPrediction?.text).toBe("cat");

    controller.accept(null);
    await flushPromises();

    expect(inference.recognize).toHaveBeenLastCalledWith(
      expect.objectContaining({ finalize: true }),
    );
    expect(useDetectionsStore.getState().currentPrediction?.text).toBe("cat");
  });
});

function frame(offset: number): Frame {
  return Array.from(
    { length: 162 },
    (_, index) => Math.round((offset + index * 0.001) * 10_000) / 10_000,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function response(text: string, committed: boolean): RecognizeOut {
  const prediction = {
    label: text,
    confidence: 0.92,
    lm_score: null,
    logit_score: null,
    raw_label: null,
  };
  return {
    state: {
      display: null,
      final_candidate: null,
      selected_text: text,
      selected_streak: 1,
      display_misses: 0,
      counts: [],
    },
    display_prediction: prediction,
    committed,
    trace: {
      prediction: null,
      decode: committed
        ? null
        : {
            buffered_frames: 1,
            input_text: text,
            display_text: text,
            idle_frames: 0,
            motion: 0,
            latency_ms: 1,
          },
      finalize: committed
        ? {
            text,
            confidence: prediction.confidence,
            committed: true,
            endpoint_reason: "landmark-lost",
            segment_frames: minFrames,
          }
        : null,
    },
  };
}
