import { recognizeFrames, run, warmInference } from "@/lib/inference/client";
import {
  acceptedFrameTime,
  frameMotion,
  streamTiming,
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
  RecognizeOut,
  StreamCtrl,
  WireDecodeTrace,
  WireFinalizeTrace,
} from "@/types/inference";
import { toDetectionPrediction } from "@/types/inference";

export function createStreamCtrl(frameRate?: number): StreamCtrl {
  const {
    holdMs,
    idleMs,
    lostMs,
    maxFrames,
    minMs,
    motionMin,
    stallMs,
    strideMs,
  } = streamTiming(frameRate);
  const finalHoldMs = holdMs * 2;
  const staleDecodeMs = holdMs * 2;
  let frames: Frame[] = [];
  let seen = 0;
  let inFlight = false;
  let last: Frame | null = null;
  let segmentStartedAt = 0;
  let idleStartedAt = 0;
  let missingStartedAt = 0;
  let lastDecodeAt = 0;
  let idle = 0;
  let moved = false;
  let ended = false;
  let epoch = 0;
  let lastMotion = 0;
  let lost = 0;
  let lastAt = 0;
  let clearTimer: number | null = null;
  let disposed = false;
  let state: RecognitionState | null = null;

  const setPrediction = useDetectionsStore.getState().setCurrentPrediction;

  const clearHold = () => {
    if (clearTimer === null) return;
    window.clearTimeout(clearTimer);
    clearTimer = null;
  };

  const resetSegment = () => {
    frames = [];
    seen = 0;
    last = null;
    lastAt = 0;
    segmentStartedAt = 0;
    idleStartedAt = 0;
    missingStartedAt = 0;
    lastDecodeAt = 0;
    idle = 0;
    moved = false;
    lost = 0;
  };

  const resetLive = () => {
    clearHold();
    setPrediction(null);
    resetSegment();
    state = null;
  };

  const reset = () => {
    epoch += 1;
    inFlight = false;
    ended = false;
    resetLive();
  };

  const start = () => {
    void warmInference();
  };

  const dispose = () => {
    disposed = true;
    epoch += 1;
    resetLive();
  };

  const updateMotion = (frame: Frame, acceptedAt: number) => {
    const motion = frameMotion(last, frame);
    lastMotion = motion;

    if (motion >= motionMin) {
      clearHold();
      if (ended) resetSegment();
      last = frame;
      segmentStartedAt ||= acceptedAt;
      ended = false;
      moved = true;
      idle = 0;
      idleStartedAt = 0;
      return;
    }
    last = frame;
    if (moved) {
      idle += 1;
      idleStartedAt ||= acceptedAt;
    }
  };

  const decodeContext = (idleFrames: number): RecognitionContext => ({
    idle_frames: idleFrames,
    missing_frames: lost,
    segment_frames: seen,
    motion: lastMotion,
  });

  const endpointContext = (
    endpointReason: EndpointReason,
  ): RecognitionContext => ({
    idle_frames: idle,
    missing_frames: lost,
    segment_frames: seen,
    motion: lastMotion,
    endpoint_reason: endpointReason,
  });

  const finalize = (endpointReason: EndpointReason) => {
    const activeState = state;
    const context = endpointContext(endpointReason);
    const finalFrames = frames.slice();

    clearHold();
    ended = true;
    epoch += 1;
    state = null;
    resetSegment();
    if (!activeState) {
      setPrediction(null);
      return;
    }
    const finalEpoch = epoch;
    void finalizeRemote(activeState, context, finalFrames, finalEpoch);
  };

  const decode = async (batch: Frame[], idleFrames: number) => {
    const batchEpoch = epoch;
    const startedAt = performance.now();
    inFlight = true;
    try {
      const result = await run(
        recognizeFrames({
          frames: batch,
          state,
          context: decodeContext(idleFrames),
        }),
      );
      if (batchEpoch !== epoch) return;
      if (performance.now() - startedAt > staleDecodeMs) return;

      state = result.state;
      if (result.trace.prediction) {
        pushPredictTrace(result.trace.prediction, {
          latencyMs: result.trace.decode?.latency_ms ?? 0,
          idleFrames,
          frames: batch.length,
          motion: lastMotion,
        });
      }

      const displayPrediction = toDetectionPrediction(
        result.display_prediction,
        result.trace.decode?.latency_ms ?? 0,
      );
      if (displayPrediction) setPrediction(displayPrediction);
      if (result.trace.decode) pushDecodeTrace(result.trace.decode);
    } catch {
      if (batchEpoch === epoch) resetLive();
    } finally {
      inFlight = false;
    }
  };

  const finalizeRemote = async (
    state: RecognitionState,
    context: RecognitionContext,
    frames: Frame[],
    finalEpoch: number,
  ) => {
    let result: RecognizeOut;
    try {
      result = await run(
        recognizeFrames({
          frames,
          state,
          context,
          finalize: true,
        }),
      );
    } catch {
      if (!disposed && finalEpoch === epoch) resetLive();
      return;
    }

    if (disposed || finalEpoch !== epoch) return;
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
    const now = performance.now();
    const tooShort = !segmentStartedAt || now - segmentStartedAt < minMs;
    if (!moved || (tooShort && !state && !inFlight)) {
      resetLive();
      return;
    }

    lost += 1;
    idle += 1;
    missingStartedAt ||= now;
    idleStartedAt ||= now;
    if (now - missingStartedAt >= lostMs || now - idleStartedAt >= idleMs) {
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
    missingStartedAt = 0;
    const acceptedAt = acceptedFrameTime(lastAt, frameRate);
    if (acceptedAt === null) return;
    if (lastAt && acceptedAt - lastAt > stallMs) reset();
    lastAt = acceptedAt;

    updateMotion(frame, acceptedAt);
    segmentStartedAt ||= acceptedAt;
    if (ended) return;

    frames.push(frame);
    if (frames.length > maxFrames) frames.splice(0, frames.length - maxFrames);
    seen += 1;

    if (idleStartedAt && acceptedAt - idleStartedAt >= idleMs) {
      finalize("idle");
      return;
    }
    if (acceptedAt - segmentStartedAt < minMs) return;
    if (acceptedAt - lastDecodeAt < strideMs || inFlight) return;

    lastDecodeAt = acceptedAt;
    void decode(frames.slice(), idle);
  };

  return { accept, dispose, reset, start };
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
