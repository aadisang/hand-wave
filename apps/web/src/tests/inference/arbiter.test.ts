import { describe, expect, test } from "vitest";
import { createArbiter } from "@/lib/inference/arbiter";
import type { StreamPred } from "@/types/inference";

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
}): StreamPred {
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

describe("createArbiter", () => {
  test("shows the primary model label over a beam-only tail", () => {
    const arbiter = createArbiter();
    const update = arbiter.accept(
      streamPrediction({
        raw: "hello",
        alternatives: [{ label: "hellon", confidence: 0.99 }],
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
  });

  test("suppresses low-confidence live output", () => {
    const arbiter = createArbiter();
    const update = arbiter.accept(
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
    const arbiter = createArbiter();
    arbiter.accept(
      streamPrediction({ raw: "ligh", greedy: "liga", confidence: 0.07 }),
      context,
    );
    arbiter.accept(
      streamPrediction({ raw: "light", confidence: 0.67 }),
      context,
    );
    const update = arbiter.accept(
      streamPrediction({ raw: "light", confidence: 0.8 }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("light");
    expect(arbiter.finalize(finalize).displayPrediction?.text).toBe("light");
  });

  test("replaces a bad early display with a stable later label", () => {
    const arbiter = createArbiter();
    arbiter.accept(
      streamPrediction({ raw: "mayse", confidence: 0.95 }),
      context,
    );

    let update = arbiter.accept(
      streamPrediction({ raw: "myname" }),
      context,
    );
    update = arbiter.accept(streamPrediction({ raw: "myname" }), context);
    update = arbiter.accept(streamPrediction({ raw: "myname" }), context);

    expect(update.displayPrediction?.text).toBe("myname");
  });

  test("commits a confident long word at endpoint", () => {
    const arbiter = createArbiter();
    arbiter.accept(
      streamPrediction({ raw: "alligator", confidence: 0.32 }),
      context,
    );

    const result = arbiter.finalize(finalize);

    expect(result.committed).toBe(true);
    expect(result.displayPrediction?.text).toBe("alligator");
  });

  test("does not commit weak long hallucinations", () => {
    const arbiter = createArbiter();
    arbiter.accept(
      streamPrediction({ raw: "hithisadi", confidence: 0.48, lmScore: -1.98 }),
      context,
    );
    arbiter.accept(
      streamPrediction({ raw: "hithisadi", confidence: 0.52, lmScore: -1.98 }),
      context,
    );

    expect(arbiter.finalize(finalize).committed).toBe(false);
  });

  test("keeps the full phrase when the rolling window returns a suffix", () => {
    const arbiter = createArbiter();
    arbiter.accept(
      streamPrediction({ raw: "helmynameischad", confidence: 0.39 }),
      context,
    );

    let update = arbiter.accept(
      streamPrediction({ raw: "myname ischad", confidence: 0.98 }),
      { ...context, idleFrames: 10 },
    );
    update = arbiter.accept(
      streamPrediction({ raw: "myname ischad", confidence: 0.95 }),
      { ...context, idleFrames: 14 },
    );

    expect(update.displayPrediction?.text).toBe("helmynameischad");
  });
});
