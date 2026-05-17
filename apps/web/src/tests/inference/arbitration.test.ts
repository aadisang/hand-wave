import { describe, expect, test } from "vitest";
import { createInferenceArbitrator } from "@/lib/inference/arbitration";
import type { StreamPrediction } from "@/types/inference";

function streamPrediction({
  raw,
  greedy = raw,
  alternatives = [],
  confidence = 0.62,
}: {
  raw: string;
  greedy?: string;
  alternatives?: Array<{ label: string; confidence: number }>;
  confidence?: number;
}): StreamPrediction {
  return {
    session_id: "session",
    buffered_frames: 64,
    prediction: { label: raw, confidence },
    alternatives,
    spans: [],
    greedy_text: greedy,
    blank_ratio: 0.2,
    tail_blank_ratio: 0.7,
    tail_blank_frames: 4,
    partial_text: raw,
    stable_text: "",
  };
}

const context = { latencyMs: 40, idleFrames: 0, motion: 0.01 };

describe("InferenceArbitrator", () => {
  test("ignores beam-only one-character tail extensions when raw and greedy agree", () => {
    const arbitrator = createInferenceArbitrator();
    const update = arbitrator.accept(
      streamPrediction({
        raw: "hello",
        greedy: "hello",
        alternatives: [{ label: "hellon", confidence: 0.99 }],
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
    expect(update.trace.selectedSource).toBe("raw");
  });

  test("does not promote a weak raw tail extension after three repeats", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "hello", greedy: "hello" }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({ raw: "hellon", greedy: "hello" }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "hellon", greedy: "hello" }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "hellon", greedy: "hello" }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
  });

  test("uses greedy over an alt beam that repairs the prefix but adds a tail", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(streamPrediction({ raw: "hel", greedy: "hel" }), context);

    const update = arbitrator.accept(
      streamPrediction({
        raw: "ellon",
        greedy: "hello",
        alternatives: [{ label: "hellon", confidence: 0.93 }],
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
    expect(update.trace.selectedSource).toBe("greedy");
  });

  test("lets a stable later raw candidate replace a bad early display", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "mayse", greedy: "mayse", confidence: 0.95 }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({ raw: "myname", greedy: "myname" }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "myname", greedy: "myname" }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "myname", greedy: "myname" }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "myname", greedy: "myname" }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("myname");
  });
});
