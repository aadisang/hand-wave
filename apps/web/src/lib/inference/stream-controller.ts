import * as Exit from "effect/Exit";
import {
  appendInferenceFrames,
  createInferenceSession,
  deleteInferenceSession,
  resetInferenceSession,
  runInference,
  runInferenceExit,
} from "@/lib/inference/client";
import {
  acceptedFrameTime,
  createInferenceArbitrator,
  finalizedDisplayMs,
  frameMotion,
  idleFramesToFinalize,
  lostFramesToFinalize,
  minDecodeFrames,
  motionThreshold,
  strideFrames,
} from "@/lib/inference/arbitration";
import { useDetectionsStore } from "@/stores/detections-store";
import { useDevStore } from "@/stores/dev-store";
import type {
  DecodeTrace,
  EndpointReason,
  FinalizeTrace,
  InferenceStreamController,
  LandmarkFrame,
} from "@/types/inference";

export function createInferenceStreamController(): InferenceStreamController {
  let sessionId = "";
  let queuedFrames: LandmarkFrame[] = [];
  let framesSeen = 0;
  let inFlight = false;
  let lastFrame: LandmarkFrame | null = null;
  let idleFrames = 0;
  let hasMoved = false;
  let endpointed = false;
  let generation = 0;
  let lastMotion = 0;
  let missingFrames = 0;
  let lastAcceptedFrameMs = 0;
  let clearPredictionTimeout: number | null = null;
  let disposed = false;
  const arbitrator = createInferenceArbitrator();

  const setPrediction = useDetectionsStore.getState().setCurrentPrediction;

  const clearDisplayReset = () => {
    if (clearPredictionTimeout === null) return;
    window.clearTimeout(clearPredictionTimeout);
    clearPredictionTimeout = null;
  };

  const resetSegment = () => {
    queuedFrames = [];
    framesSeen = 0;
    lastFrame = null;
    lastAcceptedFrameMs = 0;
    idleFrames = 0;
    hasMoved = false;
    missingFrames = 0;
  };

  const resetLiveState = () => {
    clearDisplayReset();
    setPrediction(null);
    resetSegment();
    arbitrator.reset();
  };

  const start = async () => {
    const nextSessionId = await runInference(createInferenceSession());
    if (disposed) {
      void runInference(deleteInferenceSession(nextSessionId));
      return;
    }
    sessionId = nextSessionId;
  };

  const dispose = () => {
    disposed = true;
    const activeSessionId = sessionId;
    sessionId = "";
    generation += 1;
    resetLiveState();
    if (activeSessionId)
      void runInference(deleteInferenceSession(activeSessionId));
  };

  const updateMotion = (frame: LandmarkFrame) => {
    const motion = frameMotion(lastFrame, frame);
    lastMotion = motion;
    lastFrame = frame;

    if (motion >= motionThreshold) {
      clearDisplayReset();
      if (endpointed) resetSegment();
      endpointed = false;
      hasMoved = true;
      idleFrames = 0;
      return;
    }
    if (hasMoved) idleFrames += 1;
  };

  const finalize = (endpointReason: EndpointReason) => {
    const finalized = arbitrator.finalize({
      endpointReason,
      idleFrames,
      missingFrames,
      segmentFrames: framesSeen,
    });

    clearDisplayReset();
    setPrediction(finalized.displayPrediction);
    if (finalized.displayPrediction) {
      clearPredictionTimeout = window.setTimeout(() => {
        setPrediction(null);
        clearPredictionTimeout = null;
      }, finalizedDisplayMs);
    }

    pushFinalizeTrace(finalized.trace);
    endpointed = true;
    generation += 1;
    arbitrator.reset();
    resetSegment();
    void runInference(resetInferenceSession(sessionId));
  };

  const decode = async (frames: LandmarkFrame[], decodeIdleFrames: number) => {
    const decodeGeneration = generation;
    const startedAt = performance.now();
    inFlight = true;

    const exit = await runInferenceExit(
      appendInferenceFrames(sessionId, frames),
    );
    inFlight = false;
    if (decodeGeneration !== generation || !Exit.isSuccess(exit)) return;

    const update = arbitrator.accept(exit.value, {
      latencyMs: performance.now() - startedAt,
      idleFrames: decodeIdleFrames,
      motion: lastMotion,
    });
    if (update.displayPrediction) setPrediction(update.displayPrediction);
    pushDecodeTrace(update.trace);
  };

  const acceptMissingFrame = () => {
    if (endpointed) return;
    if (!hasMoved || framesSeen < minDecodeFrames) {
      resetLiveState();
      return;
    }

    missingFrames += 1;
    idleFrames += 1;
    if (
      missingFrames >= lostFramesToFinalize ||
      idleFrames >= idleFramesToFinalize
    ) {
      finalize("landmark-lost");
    }
  };

  const accept = (frame: LandmarkFrame | null) => {
    if (!sessionId) return;
    if (!frame) {
      acceptMissingFrame();
      return;
    }

    missingFrames = 0;
    const acceptedAt = acceptedFrameTime(lastAcceptedFrameMs);
    if (acceptedAt === null) return;
    lastAcceptedFrameMs = acceptedAt;

    updateMotion(frame);
    if (endpointed) return;

    queuedFrames.push(frame);
    framesSeen += 1;

    if (idleFrames >= idleFramesToFinalize) {
      finalize("idle");
      return;
    }
    if (framesSeen < minDecodeFrames) return;
    if (framesSeen % strideFrames !== 0 || inFlight) return;

    void decode(queuedFrames.splice(0), idleFrames);
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
