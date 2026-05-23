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
    stable_text: raw.slice(0, Math.max(0, raw.length - 1)),
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

  test("promotes a repeated raw final-letter completion when model output agrees", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "ligh",
        greedy: "liga",
        confidence: 0.07,
        lmScore: -0.32,
      }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({
        raw: "light",
        greedy: "light",
        confidence: 0.67,
        lmScore: 0.75,
      }),
      context,
    );
    update = arbitrator.accept(
      streamPrediction({
        raw: "light",
        greedy: "light",
        confidence: 0.8,
        lmScore: 0.75,
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("light");
    expect(
      arbitrator.finalize({
        endpointReason: "idle",
        idleFrames: 16,
        missingFrames: 0,
        segmentFrames: 69,
      }).displayPrediction?.text,
    ).toBe("light");
  });

  test("hides low-confidence live hallucinations before they stabilize", () => {
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

  test("keeps greedy text diagnostic instead of using it for display", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(streamPrediction({ raw: "hel", greedy: "hel" }), context);

    const update = arbitrator.accept(
      streamPrediction({
        raw: "hello",
        greedy: "uhhello",
        alternatives: [{ label: "hellon", confidence: 0.93 }],
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("hello");
    expect(update.trace.selectedSource).toBe("raw");
    expect(update.trace.greedyText).toBe("uhhello");
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

  test("lets a more confident raw candidate replace a sticky wrong display", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "tebu", greedy: "tebu", confidence: 0.08 }),
      context,
    );

    const update = arbitrator.accept(
      streamPrediction({ raw: "zebra", greedy: "zebra", confidence: 0.6 }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("zebra");
  });

  test("lets a longer backend correction replace a sticky short prefix", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "alix", greedy: "alix", confidence: 0.52 }),
      context,
    );

    const update = arbitrator.accept(
      streamPrediction({
        raw: "alligator",
        greedy: "alligaton",
        confidence: 0.46,
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("alligator");
  });

  test("lets a raw streaming word grow beyond a stable prefix", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "kanga", greedy: "kanga", confidence: 0.65 }),
      context,
    );

    const update = arbitrator.accept(
      streamPrediction({
        raw: "kangaroo",
        greedy: "kangaroo",
        confidence: 0.33,
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("kangaroo");
  });

  test("does not replace a compact word with a spaced spelling variant", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({ raw: "alligator", greedy: "alligator" }),
      context,
    );

    const update = arbitrator.accept(
      streamPrediction({
        raw: "all i gatt or",
        greedy: "alligator",
        confidence: 0.9,
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("alligator");
  });

  test("prefers backend lexical label over a noisy greedy collapse", () => {
    const arbitrator = createInferenceArbitrator();

    const update = arbitrator.accept(
      streamPrediction({
        raw: "whale",
        greedy: "uhale",
        confidence: 0.38,
      }),
      context,
    );

    expect(update.displayPrediction?.text).toBe("whale");
    expect(update.trace.selectedSource).toBe("raw");
  });

  test("commits long single-token predictions after one confident decode", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "alligator",
        greedy: "alligator",
        confidence: 0.32,
      }),
      context,
    );

    const finalized = arbitrator.finalize({
      endpointReason: "landmark-lost",
      idleFrames: 10,
      missingFrames: 10,
      segmentFrames: 53,
    });

    expect(finalized.committed).toBe(true);
    expect(finalized.displayPrediction?.text).toBe("alligator");
  });

  test("does not commit long low-language hallucinations without strong evidence", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "hithisadi",
        greedy: "hithisadi",
        confidence: 0.48,
        lmScore: -1.98,
      }),
      context,
    );
    arbitrator.accept(
      streamPrediction({
        raw: "hithisadi",
        greedy: "hithisadi",
        confidence: 0.52,
        lmScore: -1.98,
      }),
      context,
    );

    const finalized = arbitrator.finalize({
      endpointReason: "idle",
      idleFrames: 16,
      missingFrames: 0,
      segmentFrames: 133,
    });

    expect(finalized.committed).toBe(false);
    expect(finalized.trace.lmScore).toBe(-1.98);
  });

  test("commits stable high-language phrases at moderate model confidence", () => {
    const arbitrator = createInferenceArbitrator();
    for (let i = 0; i < 3; i += 1) {
      arbitrator.accept(
        streamPrediction({
          raw: "hello this chad",
          greedy: "hello this chad",
          confidence: 0.29,
          lmScore: 2.01,
        }),
        context,
      );
    }

    const finalized = arbitrator.finalize({
      endpointReason: "idle",
      idleFrames: 16,
      missingFrames: 0,
      segmentFrames: 152,
    });

    expect(finalized.committed).toBe(true);
    expect(finalized.displayPrediction?.text).toBe("hello this chad");
  });

  test("does not commit suspicious short-token phrases from language score alone", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "qu are you",
        greedy: "qu are you",
        confidence: 0.29,
        lmScore: 2.64,
      }),
      context,
    );
    arbitrator.accept(
      streamPrediction({
        raw: "qu are you",
        greedy: "qu are you",
        confidence: 0.29,
        lmScore: 2.64,
      }),
      context,
    );

    const finalized = arbitrator.finalize({
      endpointReason: "idle",
      idleFrames: 16,
      missingFrames: 0,
      segmentFrames: 112,
    });

    expect(finalized.committed).toBe(false);
  });

  test("does not let a lower-confidence repeat erase commit confidence", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "alligator",
        greedy: "alligator",
        confidence: 0.53,
      }),
      context,
    );
    arbitrator.accept(
      streamPrediction({
        raw: "alligator",
        greedy: "alligator",
        confidence: 0.17,
      }),
      context,
    );

    const finalized = arbitrator.finalize({
      endpointReason: "landmark-lost",
      idleFrames: 10,
      missingFrames: 10,
      segmentFrames: 53,
    });

    expect(finalized.committed).toBe(true);
    expect(finalized.trace.confidence).toBe(0.53);
  });

  test("does not commit repeated low-confidence short fragments", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(streamPrediction({ raw: "say", confidence: 0.18 }), context);
    arbitrator.accept(streamPrediction({ raw: "say", confidence: 0.18 }), context);
    arbitrator.accept(streamPrediction({ raw: "say", confidence: 0.18 }), context);

    const finalized = arbitrator.finalize({
      endpointReason: "idle",
      idleFrames: 16,
      missingFrames: 0,
      segmentFrames: 70,
    });

    expect(finalized.committed).toBe(false);
    expect(finalized.displayPrediction).toBeNull();
  });

  test("does not commit repeated low-confidence phrase fragments", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(streamPrediction({ raw: "a or", confidence: 0.06 }), context);
    arbitrator.accept(streamPrediction({ raw: "a or", confidence: 0.06 }), context);
    arbitrator.accept(streamPrediction({ raw: "a or", confidence: 0.06 }), context);

    const finalized = arbitrator.finalize({
      endpointReason: "landmark-lost",
      idleFrames: 10,
      missingFrames: 10,
      segmentFrames: 71,
    });

    expect(finalized.committed).toBe(false);
    expect(finalized.displayPrediction).toBeNull();
  });

  test("keeps a full phrase when a rolling window later returns its suffix", () => {
    const arbitrator = createInferenceArbitrator();
    arbitrator.accept(
      streamPrediction({
        raw: "helmynameischad",
        greedy: "helmynameischad",
        confidence: 0.39,
      }),
      context,
    );

    let update = arbitrator.accept(
      streamPrediction({
        raw: "myname ischad",
        greedy: "myname ischad",
        confidence: 0.98,
      }),
      { ...context, idleFrames: 10, motion: 0.001 },
    );
    update = arbitrator.accept(
      streamPrediction({
        raw: "myname ischad",
        greedy: "myname ischad",
        confidence: 0.95,
      }),
      { ...context, idleFrames: 14, motion: 0.001 },
    );

    expect(update.displayPrediction?.text).toBe("helmynameischad");
  });
});
