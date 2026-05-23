import { describe, expect, test } from "vitest";
import { createInferenceArbitrator } from "@/lib/inference/arbitration";
import type { StreamPrediction } from "@/types/inference";

function streamPrediction({
  raw,
  greedy = raw,
  alternatives = [],
  confidence = 0.62,
  lmScore = 0,
}: {
  raw: string;
  greedy?: string;
  alternatives?: Array<{ label: string; confidence: number }>;
  confidence?: number;
  lmScore?: number;
}): StreamPrediction {
  return {
    session_id: "session",
    buffered_frames: 64,
    prediction: { label: raw, confidence, lm_score: lmScore },
    alternatives,
    spans: [],
    greedy_text: greedy,
    blank_ratio: 0.2,
    tail_blank_ratio: 0.7,
    tail_blank_frames: 4,
    partial_text: raw,
    stable_text: raw,
  };
}

const context = { latencyMs: 40, idleFrames: 0, motion: 0.01 };
const finalize = {
  endpointReason: "idle" as const,
  idleFrames: 16,
  missingFrames: 0,
  segmentFrames: 80,
};

describe("InferenceArbitrator", () => {
  test("shows the primary model label over a beam-only tail", () => {
    const arbitrator = createInferenceArbitrator();
    const update = arbitrator.accept(
      streamPrediction({
        raw: "hello",
        alternatives: [{ label: "hellon", confidence: 0.99 }],
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
  });

  test("suppresses low-confidence live output", () => {
    const arbitrator = createInferenceArbitrator();
    const update = arbitrator.accept(
      streamPrediction({
        raw: "no oc once",
        greedy: "noonconce",
        confidence: 0.12,
        lmScore: 2.15,
      }),
      context,
    );

    expect(update.displayPrediction).toBeNull();
  });

  test("promotes a repeated final-letter completion", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "ligh", greedy: "liga", confidence: 0.07 }),
      context,
    );
    arbitrator.accept(
      streamPrediction({ raw: "light", confidence: 0.67 }),
      context,
    );
    const update = arbitrator.accept(
      streamPrediction({ raw: "light", confidence: 0.8 }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("light");
    expect(arbitrator.finalize(finalize).displayPrediction?.text).toBe("light");
  });

  test("replaces a bad early display with a stable later label", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "mayse", confidence: 0.95 }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({ raw: "myname" }),
      context,
    );
    update = arbitrator.accept(streamPrediction({ raw: "myname" }), context);
    update = arbitrator.accept(streamPrediction({ raw: "myname" }), context);

    expect(update.displayPrediction?.text).toBe("myname");
  });

  test("commits a confident long word at endpoint", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "alligator", confidence: 0.32 }),
      context,
    );

    const result = arbitrator.finalize(finalize);

    expect(result.committed).toBe(true);
    expect(result.displayPrediction?.text).toBe("alligator");
  });

  test("does not commit weak long hallucinations", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "hithisadi", confidence: 0.48, lmScore: -1.98 }),
      context,
    );
    arbitrator.accept(
      streamPrediction({ raw: "hithisadi", confidence: 0.52, lmScore: -1.98 }),
      context,
    );

    expect(arbitrator.finalize(finalize).committed).toBe(false);
  });

  test("keeps the full phrase when the rolling window returns a suffix", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "helmynameischad", confidence: 0.39 }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({ raw: "myname ischad", confidence: 0.98 }),
      { ...context, idleFrames: 10 },
    );
    update = arbitrator.accept(
      streamPrediction({ raw: "myname ischad", confidence: 0.95 }),
      { ...context, idleFrames: 14 },
    );

    expect(update.displayPrediction?.text).toBe("helmynameischad");
  });
});
