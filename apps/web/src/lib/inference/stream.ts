import {
  clearInferenceSession,
  closeInferenceStream,
  prepareInferenceStream,
  recognizeFrames,
} from "@/lib/inference/client";
import {
  frameMotion,
  interpolateFrame,
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
  InferenceMode,
  StreamCtrl,
  WireDecodeTrace,
  WireFinalizeTrace,
} from "@/types/inference";
import { toDetectionPrediction } from "@/types/inference";

export function createStreamCtrl(mode: InferenceMode): StreamCtrl {
  type RequestPhase =
    | { kind: "idle" }
    | { kind: "decode"; id: number; epoch: number }
    | { kind: "finalize"; id: number; epoch: number };
  type PendingFinalize = {
    context: RecognitionContext;
    frames: Frame[];
    epoch: number;
  };
  const {
    holdMs,
    idleMs,
    lostMs,
    maxFrames,
    minMs,
    motionMin,
    sampleMs,
    stallMs,
    strideMs,
  } = streamTiming();
  const finalHoldMs = holdMs * 2;
  let frames: Frame[] = [];
  let seen = 0;
  let requestPhase: RequestPhase = { kind: "idle" };
  let requestID = 0;
  let pendingFinalize: PendingFinalize | null = null;
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
  let lastObserved: Frame | null = null;
  let lastObservedAt = 0;
  let nextSampleAt = 0;
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
    segmentStartedAt = 0;
    idleStartedAt = 0;
    missingStartedAt = 0;
    lastDecodeAt = 0;
    idle = 0;
    moved = false;
    lost = 0;
  };

  const resetSampling = () => {
    lastObserved = null;
    lastObservedAt = 0;
    nextSampleAt = 0;
  };

  const resetRecognition = () => {
    clearHold();
    setPrediction(null);
    resetSegment();
    resetSampling();
    state = null;
  };

  const reset = () => {
    epoch += 1;
    requestPhase = { kind: "idle" };
    pendingFinalize = null;
    ended = false;
    resetRecognition();
    void clearInferenceSession(mode).catch(() => undefined);
  };

  const start = () => {
    void prepareInferenceStream(mode).catch(() => undefined);
  };

  const dispose = () => {
    disposed = true;
    epoch += 1;
    requestPhase = { kind: "idle" };
    pendingFinalize = null;
    resetRecognition();
    closeInferenceStream(mode);
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
    const context = endpointContext(endpointReason);
    const finalFrames = frames.slice();

    clearHold();
    ended = true;
    resetSegment();
    pendingFinalize = { context, frames: finalFrames, epoch };
    if (requestPhase.kind === "idle") startFinalization();
  };

  const decode = async (batch: Frame[], idleFrames: number) => {
    const batchEpoch = epoch;
    const id = ++requestID;
    requestPhase = { kind: "decode", id, epoch: batchEpoch };
    try {
      const result = await recognizeFrames(mode, {
        input: "frames",
        frames: batch,
        state,
        context: decodeContext(idleFrames),
      });
      if (!isActiveRequest("decode", id, batchEpoch)) return;
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
      if (isActiveRequest("decode", id, batchEpoch)) {
        requestPhase = { kind: "idle" };
        pendingFinalize = null;
        resetRecognition();
      }
      return;
    }
    if (!isActiveRequest("decode", id, batchEpoch)) return;
    requestPhase = { kind: "idle" };
    if (pendingFinalize) startFinalization();
  };

  const isActiveRequest = (
    kind: "decode" | "finalize",
    id: number,
    requestEpoch: number,
  ) =>
    requestPhase.kind === kind &&
    requestPhase.id === id &&
    requestPhase.epoch === requestEpoch &&
    epoch === requestEpoch;

  const startFinalization = () => {
    const pending = pendingFinalize;
    pendingFinalize = null;
    if (!pending || pending.epoch !== epoch) return;
    const activeState = state;
    state = null;
    if (!activeState) {
      setPrediction(null);
      return;
    }
    const id = ++requestID;
    requestPhase = { kind: "finalize", id, epoch: pending.epoch };
    void finalizeRemote(activeState, pending, id);
  };

  const finalizeRemote = async (
    activeState: RecognitionState,
    pending: PendingFinalize,
    id: number,
  ) => {
    let result: RecognizeOut;
    try {
      result = await recognizeFrames(mode, {
        input: "frames",
        frames: pending.frames,
        state: activeState,
        context: pending.context,
        finalize: true,
      });
    } catch {
      if (!disposed && isActiveRequest("finalize", id, pending.epoch)) {
        requestPhase = { kind: "idle" };
        resetRecognition();
      }
      return;
    }

    if (disposed || !isActiveRequest("finalize", id, pending.epoch)) return;
    requestPhase = { kind: "idle" };
    const prediction = toDetectionPrediction(
      result.display_prediction,
      0,
      result.committed,
    );
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
    resetSampling();
    if (ended) return;
    const now = performance.now();
    const tooShort = !segmentStartedAt || now - segmentStartedAt < minMs;
    if (!moved || (tooShort && !state && requestPhase.kind === "idle")) {
      resetRecognition();
      return;
    }

    missingStartedAt ||= now;
    idleStartedAt ||= now;
    lost = Math.max(1, Math.round((now - missingStartedAt) / sampleMs));
    idle = Math.max(idle, Math.round((now - idleStartedAt) / sampleMs));
    if (now - missingStartedAt >= lostMs || now - idleStartedAt >= idleMs) {
      finalize("landmark-lost");
    }
  };

  const acceptSample = (frame: Frame, acceptedAt: number) => {
    lost = 0;
    missingStartedAt = 0;
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
    if (acceptedAt - lastDecodeAt < strideMs || requestPhase.kind !== "idle") {
      return;
    }

    lastDecodeAt = acceptedAt;
    void decode(frames.slice(), idle);
  };

  const accept = (frame: Frame | null) => {
    if (disposed) return;
    if (!frame) {
      acceptMissingFrame();
      return;
    }

    const observedAt = performance.now();
    if (lastObservedAt && observedAt - lastObservedAt > stallMs) reset();

    const previous = lastObserved;
    const previousAt = lastObservedAt;
    lastObserved = frame;
    lastObservedAt = observedAt;

    if (!previous || previousAt === 0 || nextSampleAt === 0) {
      nextSampleAt = observedAt + sampleMs;
      acceptSample(frame, observedAt);
      return;
    }

    while (nextSampleAt <= observedAt) {
      const duration = observedAt - previousAt;
      const progress =
        duration > 0 ? (nextSampleAt - previousAt) / duration : 1;
      acceptSample(interpolateFrame(previous, frame, progress), nextSampleAt);
      nextSampleAt += sampleMs;
    }
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
