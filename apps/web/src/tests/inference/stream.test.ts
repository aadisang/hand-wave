import { beforeEach, describe, expect, test, vi } from "vitest";
import { cfg } from "@hand-wave/contract";
import { createStreamCtrl } from "@/lib/inference/stream";
import { interpolateFrame, streamTiming } from "@/lib/inference/stream-gate";
import { useDetectionsStore } from "@/stores/detections-store";
import type {
  Frame,
  FrameRecognizeIn,
  InferenceMode,
  RecognizeOut,
} from "@/types/inference";

const { lost, minFrames, stride } = streamTiming();

const inference = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<void>>(),
  recognize: vi.fn<(payload: FrameRecognizeIn) => Promise<RecognizeOut>>(),
  resetSession: vi.fn<() => Promise<void>>(),
  warm: vi.fn(),
}));

let clockStepMs = 40;

vi.mock("@/lib/inference/client", () => ({
  clearInferenceSession: inference.resetSession,
  prepareInferenceStream: inference.prepare,
  recognizeFrames: vi.fn((_mode: InferenceMode, payload: FrameRecognizeIn) =>
    inference.recognize(payload),
  ),
  warmInference: inference.warm,
}));

describe("stream controller", () => {
  beforeEach(() => {
    clockStepMs = 40;
    vi.restoreAllMocks();
    vi.stubGlobal("window", globalThis);
    useDetectionsStore.setState({ currentPrediction: null });
    inference.recognize.mockReset();
    inference.prepare.mockReset();
    inference.prepare.mockResolvedValue();
    inference.resetSession.mockReset();
    inference.resetSession.mockResolvedValue();
    inference.warm.mockReset();

    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      now += clockStepMs;
      return now;
    });
  });

  test("resets recognition without closing the prepared transport", () => {
    const controller = createStreamCtrl("remote");

    for (let index = 0; index < lost * 2; index += 1) {
      controller.accept(null);
    }

    expect(inference.resetSession).not.toHaveBeenCalled();
    controller.dispose();
    expect(inference.resetSession).toHaveBeenCalledOnce();
  });

  test("resets server state without closing the transport after a frame stall", () => {
    const controller = createStreamCtrl("remote");
    clockStepMs = 100;
    controller.accept(frame(0));
    clockStepMs = streamTiming().stallMs + 1;
    controller.accept(frame(0.1));

    expect(inference.resetSession).toHaveBeenCalledOnce();
  });

  test("keeps a sign made while the server warms", async () => {
    const ready = deferred<void>();
    inference.prepare.mockReturnValue(ready.promise);
    inference.recognize.mockImplementation(async (payload) => {
      if (!isFinalizing(payload)) await ready.promise;
      return response("cat", isFinalizing(payload));
    });

    const controller = createStreamCtrl("remote");
    void controller.start();
    for (let index = 0; index < minFrames + stride + 4; index += 1) {
      controller.accept(frame(index * 0.01));
    }
    for (let index = 0; index < lost + 2; index += 1) {
      controller.accept(null);
    }

    expect(inference.recognize).toHaveBeenCalledTimes(1);
    ready.resolve();
    await flushPromises();

    controller.accept(null);
    await flushPromises();

    expect(inference.recognize).toHaveBeenCalledWith(
      expect.objectContaining({ finalize: true }),
    );
  });

  test("retries a transient decode without dropping the buffered sign", async () => {
    inference.recognize
      .mockRejectedValueOnce(new Error("reconnecting"))
      .mockResolvedValue(response("cat", false));

    const controller = createStreamCtrl("remote");
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride + 4);
    }
    const firstWindow = inference.recognize.mock.calls[0]?.[0].frames.length;
    await flushPromises();

    for (
      let index = minFrames;
      inference.recognize.mock.calls.length < 2;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride * 3);
    }

    expect(
      inference.recognize.mock.calls[1]?.[0].frames.length,
    ).toBeGreaterThan(firstWindow ?? 0);
  });

  test("decodes at the endpoint when the first live decode failed", async () => {
    inference.recognize
      .mockRejectedValueOnce(new Error("reconnecting"))
      .mockResolvedValue(response("cat", true));

    const controller = createStreamCtrl("device");
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride + 4);
    }
    await flushPromises();

    for (let index = 0; index < lost + 2; index += 1) {
      controller.accept(null);
    }
    await flushPromises();

    expect(inference.recognize).toHaveBeenLastCalledWith(
      expect.objectContaining({ finalize: true, state: null }),
    );
    expect(useDetectionsStore.getState().currentPrediction?.text).toBe("cat");
  });

  test("keeps model timing on the trained 24 FPS grid", () => {
    const timing = streamTiming();

    expect(timing.minFrames).toBe(cfg.stream.min);
    expect(timing.idle).toBe(cfg.stream.idle);
    expect(timing.lost).toBe(cfg.stream.lost);
    expect(timing.stride).toBe(cfg.stream.stride);
    expect(timing.maxFrames).toBe(cfg.decode.window);
    expect(timing.sampleMs).toBeCloseTo(1_000 / cfg.stream.fps);
  });

  test("interpolates source frames onto the model grid", () => {
    expect(interpolateFrame([0, 2], [2, 6], 0.5)).toEqual([1, 4]);
  });

  test("builds the same model window from 24 and 60 FPS input", () => {
    inference.recognize.mockResolvedValue(response("cat", false));

    const at24 = firstDecodeAtRate(24);
    inference.recognize.mockClear();
    const at60 = firstDecodeAtRate(60);

    expect(at60).toHaveLength(at24.length);
    for (let index = 0; index < at24.length; index += 1) {
      expect(at60[index]?.[0]).toBeCloseTo(at24[index]?.[0] ?? 0, 3);
    }
  });

  test("decodes low fps input on human time", () => {
    clockStepMs = 100;
    inference.recognize.mockResolvedValue(response("cat", false));

    const controller = createStreamCtrl("remote");
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(12);
    }

    expect(inference.recognize).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: expect.arrayContaining([expect.any(Array)]),
      }),
    );
  });

  test("preserves a decode response after landmarks disappear", async () => {
    const decode = deferred<RecognizeOut>();
    inference.recognize.mockImplementation((payload) =>
      isFinalizing(payload)
        ? Promise.resolve(response("cat", true))
        : decode.promise,
    );

    const controller = createStreamCtrl("remote");
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

  test("does not finalize during a normal short hold", async () => {
    inference.recognize.mockImplementation((payload) =>
      Promise.resolve(response("cat", isFinalizing(payload))),
    );

    const controller = createStreamCtrl("remote");
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride + 4);
    }
    await flushPromises();

    const heldFrame = frame(0.24);
    const holdFrames = Math.ceil(cfg.stream.fps * 0.6);
    for (let index = 0; index < holdFrames; index += 1) {
      controller.accept(heldFrame);
    }
    await flushPromises();

    expect(inference.recognize).not.toHaveBeenCalledWith(
      expect.objectContaining({ finalize: true }),
    );
    expect(useDetectionsStore.getState().currentPrediction?.text).toBe("cat");
  });

  test("clears live state when recognition fails", async () => {
    inference.recognize.mockRejectedValue(new Error("offline"));
    useDetectionsStore.getState().setCurrentPrediction({
      text: "cat",
      confidence: 0.92,
      processingTimeMs: 1,
      committed: false,
    });

    const controller = createStreamCtrl("remote");
    for (
      let index = 0;
      inference.recognize.mock.calls.length === 0;
      index += 1
    ) {
      controller.accept(frame(index * 0.01));
      expect(index).toBeLessThan(minFrames + stride + 4);
    }
    await flushPromises();

    expect(useDetectionsStore.getState().currentPrediction).toBeNull();
  });
});

function frame(offset: number): Frame {
  return Array.from(
    { length: 162 },
    (_, index) => Math.round((offset + index * 0.001) * 10_000) / 10_000,
  );
}

function firstDecodeAtRate(frameRate: number) {
  let now = 0;
  const step = 1_000 / frameRate;
  vi.mocked(performance.now).mockImplementation(() => {
    now += step;
    return now;
  });
  const controller = createStreamCtrl("remote");
  for (let index = 0; inference.recognize.mock.calls.length === 0; index += 1) {
    controller.accept(frame(index / frameRate));
    expect(index).toBeLessThan(frameRate * 2);
  }
  const payload = inference.recognize.mock.calls[0]?.[0];
  controller.dispose();
  return payload?.frames ?? [];
}

function isFinalizing(payload: FrameRecognizeIn) {
  return payload.finalize === true;
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
