import { predictFrames, run } from "@/lib/inference/client";
import {
  acceptedFrameTime,
  createArbiter,
  frameMotion,
  holdMs,
  idle as idleMax,
  lost as lostMax,
  maxFrames,
  minFrames as minSeen,
  motionMin,
  stride,
} from "@/lib/inference/arbiter";
import { useDetectionsStore } from "@/stores/detections-store";
import { useDevStore } from "@/stores/dev-store";
import type {
  DecodeTrace,
  EndpointReason,
  FinalizeTrace,
  Frame,
  InferOut,
  StreamCtrl,
} from "@/types/inference";

const finalHoldMs = holdMs * 2;

export function createStreamCtrl(): StreamCtrl {
  let frames: Frame[] = [];
  let seen = 0;
  let inFlight = false;
  let last: Frame | null = null;
  let idle = 0;
  let moved = false;
  let ended = false;
  let gen = 0;
  let lastMotion = 0;
  let lost = 0;
  let lastAcceptedAt = 0;
  let clearTimer: number | null = null;
  let disposed = false;
  const arbiter = createArbiter();

  const setPrediction = useDetectionsStore.getState().setCurrentPrediction;

  const clearDisplayReset = () => {
    if (clearTimer === null) return;
    window.clearTimeout(clearTimer);
    clearTimer = null;
  };

  const resetSegment = () => {
    frames = [];
    seen = 0;
    last = null;
    lastAcceptedAt = 0;
    idle = 0;
    moved = false;
    lost = 0;
  };

  const resetLiveState = () => {
    clearDisplayReset();
    setPrediction(null);
    resetSegment();
    arbiter.reset();
  };

  const start = async () => {};

  const dispose = () => {
    disposed = true;
    gen += 1;
    resetLiveState();
  };

  const updateMotion = (frame: Frame) => {
    const motion = frameMotion(last, frame);
    lastMotion = motion;
    last = frame;

    if (motion >= motionMin) {
      clearDisplayReset();
      if (ended) resetSegment();
      ended = false;
      moved = true;
      idle = 0;
      return;
    }
    if (moved) idle += 1;
  };

  const finalize = (endpointReason: EndpointReason) => {
    const finalized = arbiter.finalize({
      endpointReason,
      idleFrames: idle,
      missingFrames: lost,
      segmentFrames: seen,
    });

    clearDisplayReset();
    setPrediction(finalized.displayPrediction);
    if (finalized.displayPrediction) {
      clearTimer = window.setTimeout(() => {
        setPrediction(null);
        clearTimer = null;
      }, finalHoldMs);
    }

    pushFinalizeTrace(finalized.trace);
    ended = true;
    gen += 1;
    arbiter.reset();
    resetSegment();
  };

  const decode = async (windowFrames: Frame[], batchIdle: number) => {
    const batchGen = gen;
    const startedAt = performance.now();
    inFlight = true;

    let prediction: InferOut;
    try {
      prediction = await run(predictFrames(windowFrames));
    } catch {
      inFlight = false;
      return;
    }

    inFlight = false;
    if (batchGen !== gen) return;

    const update = arbiter.accept(prediction, {
      latencyMs: performance.now() - startedAt,
      idleFrames: batchIdle,
      frames: windowFrames.length,
      motion: lastMotion,
    });
    if (update.displayPrediction) setPrediction(update.displayPrediction);
    pushDecodeTrace(update.trace);
  };

  const acceptMissingFrame = () => {
    if (ended) return;
    if (!moved || seen < minSeen) {
      resetLiveState();
      return;
    }

    lost += 1;
    idle += 1;
    if (lost >= lostMax || idle >= idleMax) {
      finalize("landmark-lost");
    }
  };

  const accept = (frame: Frame | null) => {
    if (disposed) return;
    if (!frame) {
      acceptMissingFrame();
      return;
    }

    lost = 0;
    const acceptedAt = acceptedFrameTime(lastAcceptedAt);
    if (acceptedAt === null) return;
    lastAcceptedAt = acceptedAt;

    updateMotion(frame);
    if (ended) return;

    frames.push(frame);
    if (frames.length > maxFrames) frames.splice(0, frames.length - maxFrames);
    seen += 1;

    if (idle >= idleMax) {
      finalize("idle");
      return;
    }
    if (seen < minSeen) return;
    if (seen % stride !== 0 || inFlight) return;

    void decode(frames.slice(), idle);
  };

  return { accept, dispose, start };
}

function pushDecodeTrace(trace: Omit<DecodeTrace, "type" | "at">) {
  useDevStore.getState().pushTrace({
    ...trace,
    type: "decode",
    at: new Date().toISOString(),
  });
}

function pushFinalizeTrace(trace: Omit<FinalizeTrace, "type" | "at">) {
  useDevStore.getState().pushTrace({
    ...trace,
    type: "finalize",
    at: new Date().toISOString(),
  });
}
