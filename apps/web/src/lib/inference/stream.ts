import { recognizeFrames, run, warmInference } from "@/lib/inference/client";
import {
  acceptedFrameTime,
  frameMotion,
  holdMs,
  idle as idleMax,
  lost as lostMax,
  maxFrames,
  minFrames as minSeen,
  motionMin,
  stride,
} from "@/lib/inference/stream-gate";
import { useDetectionsStore } from "@/stores/detections-store";
import { useDevStore } from "@/stores/dev-store";
import type {
  EndpointReason,
  Frame,
  InferOut,
  PredictTrace,
  RecognitionContext,
  RecognitionState,
  StreamCtrl,
  WireDecodeTrace,
  WireFinalizeTrace,
} from "@/types/inference";
import { toDetectionPrediction } from "@/types/inference";

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
  let recognitionState: RecognitionState | null = null;

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
    recognitionState = null;
  };

  const start = () => {
    void warmInference();
  };

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

  const context = (endpointReason?: EndpointReason): RecognitionContext => ({
    idle_frames: idle,
    missing_frames: lost,
    segment_frames: seen,
    motion: lastMotion,
    endpoint_reason: endpointReason,
  });

  const finalize = (endpointReason: EndpointReason) => {
    const state = recognitionState;
    const finalizeContext = context(endpointReason);

    clearDisplayReset();
    ended = true;
    gen += 1;
    recognitionState = null;
    resetSegment();
    if (!state) {
      setPrediction(null);
      return;
    }
    const finalGen = gen;
    void finalizeRemote(state, finalizeContext, finalGen);
  };

  const decode = async (windowFrames: Frame[], batchIdle: number) => {
    const batchGen = gen;
    inFlight = true;
    const result = await run(
      recognizeFrames({
        frames: windowFrames,
        state: recognitionState,
        context: { ...context(), idle_frames: batchIdle },
      }),
    ).finally(() => {
      inFlight = false;
    });
    if (batchGen !== gen) return;

    recognitionState = result.state;
    if (result.trace.prediction) {
      pushPredictTrace(result.trace.prediction, {
        latencyMs: result.trace.decode?.latency_ms ?? 0,
        idleFrames: batchIdle,
        frames: windowFrames.length,
        motion: lastMotion,
      });
    }

    const displayPrediction = toDetectionPrediction(
      result.display_prediction,
      result.trace.decode?.latency_ms ?? 0,
    );
    if (displayPrediction) setPrediction(displayPrediction);
    if (result.trace.decode) pushDecodeTrace(result.trace.decode);
  };

  const finalizeRemote = async (
    state: RecognitionState,
    finalizeContext: RecognitionContext,
    finalGen: number,
  ) => {
    const result = await run(
      recognizeFrames({
        state,
        context: finalizeContext,
        finalize: true,
      }),
    );

    if (disposed || finalGen !== gen) return;
    const prediction = toDetectionPrediction(result.display_prediction);
    setPrediction(prediction);
    if (prediction) {
      clearTimer = window.setTimeout(() => {
        setPrediction(null);
        clearTimer = null;
      }, finalHoldMs);
    }
    if (result.trace.finalize) pushFinalizeTrace(result.trace.finalize);
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
      if (inFlight) return;
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

function pushPredictTrace(
  prediction: InferOut,
  context: Omit<PredictTrace, "type" | "at" | "prediction">,
) {
  const dev = useDevStore.getState();
  if (!dev.enabled) return;
  dev.pushTrace({
    ...context,
    prediction,
    type: "predict",
    at: new Date().toISOString(),
  });
}

function pushDecodeTrace(trace: WireDecodeTrace) {
  const dev = useDevStore.getState();
  if (!dev.enabled) return;
  dev.pushTrace({
    bufferedFrames: trace.buffered_frames,
    inputText: trace.input_text,
    displayText: trace.display_text,
    idleFrames: trace.idle_frames,
    motion: trace.motion,
    latencyMs: trace.latency_ms,
    type: "decode",
    at: new Date().toISOString(),
  });
}

function pushFinalizeTrace(trace: WireFinalizeTrace) {
  const dev = useDevStore.getState();
  if (!dev.enabled) return;
  dev.pushTrace({
    text: trace.text,
    confidence: trace.confidence,
    committed: trace.committed,
    endpointReason: trace.endpoint_reason,
    segmentFrames: trace.segment_frames,
    type: "finalize",
    at: new Date().toISOString(),
  });
}
