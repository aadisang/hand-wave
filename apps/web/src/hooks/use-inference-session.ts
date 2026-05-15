import { useCallback, useEffect, useRef } from "react";
import {
  appendInferenceFrames,
  createInferenceSession,
  deleteInferenceSession,
  resetInferenceSession,
  type LandmarkFrame,
} from "@/inference";
import {
  finalizedDisplayMs,
  frameMotion,
  idleFramesToFinalize,
  InferenceArbitrator,
  logDecodeTrace,
  logFinalizeTrace,
  minDecodeFrames,
  motionThreshold,
  shouldAcceptFrame,
  strideFrames,
} from "@/inference-arbitration";
import { toInferenceFrame } from "@/landmarks";
import { useDetectionsStore } from "@/stores/detections-store";
import type { HandLandmarksFrame } from "./use-hand-landmarker";

export function useInferenceSession(active: boolean) {
  const sessionIdRef = useRef<string | null>(null);
  const arbitratorRef = useRef(new InferenceArbitrator());
  const queuedFramesRef = useRef<LandmarkFrame[]>([]);
  const framesSeenRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastFrameRef = useRef<LandmarkFrame | null>(null);
  const idleFramesRef = useRef(0);
  const hasMovedRef = useRef(false);
  const endpointedRef = useRef(false);
  const generationRef = useRef(0);
  const lastMotionRef = useRef(0);
  const lastAcceptedFrameMsRef = useRef(0);
  const clearPredictionTimeoutRef = useRef<number | null>(null);

  const resetLocalState = useCallback(() => {
    queuedFramesRef.current = [];
    framesSeenRef.current = 0;
    lastFrameRef.current = null;
    lastAcceptedFrameMsRef.current = 0;
    idleFramesRef.current = 0;
    hasMovedRef.current = false;
  }, []);

  const clearPendingDisplayReset = useCallback(() => {
    if (clearPredictionTimeoutRef.current === null) return;
    window.clearTimeout(clearPredictionTimeoutRef.current);
    clearPredictionTimeoutRef.current = null;
  }, []);

  const maybeFinalizeSegment = useCallback(
    (sessionId: string) => {
      const finalized = arbitratorRef.current.finalize(idleFramesRef.current);
      if (finalized.displayPrediction && finalized.committed) {
        useDetectionsStore
          .getState()
          .pushPrediction(finalized.displayPrediction);
        clearPendingDisplayReset();
        clearPredictionTimeoutRef.current = window.setTimeout(() => {
          useDetectionsStore.getState().setCurrentPrediction(null);
          clearPredictionTimeoutRef.current = null;
        }, finalizedDisplayMs);
      }

      logFinalizeTrace(finalized.trace);

      endpointedRef.current = true;
      generationRef.current += 1;
      arbitratorRef.current.reset();
      resetLocalState();
      void resetInferenceSession(sessionId);
    },
    [clearPendingDisplayReset, resetLocalState],
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    void createInferenceSession().then((sessionId) => {
      if (cancelled) {
        void deleteInferenceSession(sessionId);
        return;
      }
      sessionIdRef.current = sessionId;
    });

    return () => {
      cancelled = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      generationRef.current += 1;
      clearPendingDisplayReset();
      resetLocalState();
      arbitratorRef.current.reset();
      if (sessionId) void deleteInferenceSession(sessionId);
    };
  }, [active, clearPendingDisplayReset, resetLocalState]);

  return useCallback(
    (frame: HandLandmarksFrame) => {
      const sessionId = sessionIdRef.current;
      const payloadFrame = toInferenceFrame(frame);
      if (!sessionId) return;
      if (!payloadFrame) {
        if (!endpointedRef.current) maybeFinalizeSegment(sessionId);
        return;
      }
      const acceptedFrame = shouldAcceptFrame(
        payloadFrame,
        lastAcceptedFrameMsRef.current,
      );
      if (!acceptedFrame.accepted) return;
      lastAcceptedFrameMsRef.current = acceptedFrame.timestampMs;

      const motion = frameMotion(lastFrameRef.current, payloadFrame);
      lastMotionRef.current = motion;
      lastFrameRef.current = payloadFrame;
      const moving = motion >= motionThreshold;

      if (moving) {
        clearPendingDisplayReset();
        if (endpointedRef.current) resetLocalState();
        endpointedRef.current = false;
        hasMovedRef.current = true;
        idleFramesRef.current = 0;
      } else if (hasMovedRef.current) {
        idleFramesRef.current += 1;
      }

      if (endpointedRef.current) return;

      queuedFramesRef.current.push(payloadFrame);
      framesSeenRef.current += 1;

      if (idleFramesRef.current >= idleFramesToFinalize) {
        maybeFinalizeSegment(sessionId);
        return;
      }

      if (framesSeenRef.current < minDecodeFrames) return;
      if (framesSeenRef.current % strideFrames !== 0 || inFlightRef.current)
        return;

      const frames = queuedFramesRef.current.splice(0);
      const generation = generationRef.current;
      const idleAtRequest = idleFramesRef.current;
      inFlightRef.current = true;
      const startedAt = performance.now();

      void appendInferenceFrames(sessionId, frames)
        .then((response) => {
          if (generation !== generationRef.current) return;
          const latencyMs = performance.now() - startedAt;
          const update = arbitratorRef.current.accept(response, {
            latencyMs,
            idleFrames: idleAtRequest,
            motion: lastMotionRef.current,
          });
          if (update.displayPrediction) {
            useDetectionsStore
              .getState()
              .setCurrentPrediction(update.displayPrediction);
          }
          logDecodeTrace(update.trace);
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    },
    [clearPendingDisplayReset, maybeFinalizeSegment, resetLocalState],
  );
}
