import { useCallback, useEffect, useRef } from "react";
import {
  appendInferenceFrames,
  createInferenceSession,
  deleteInferenceSession,
  resetInferenceSession,
  type LandmarkFrame,
} from "@/inference";
import { toInferenceFrame } from "@/landmarks";
import {
  useDetectionsStore,
  type Prediction as DetectionPrediction,
} from "@/stores/detections-store";
import type { HandLandmarksFrame } from "./use-hand-landmarker";

const minDecodeFrames = 48;
const strideFrames = 8;
const idleFramesToFinalize = 18;
const idleFramesToFreezePrediction = 10;
const motionThreshold = 0.003;

export function useInferenceSession(active: boolean) {
  const sessionIdRef = useRef<string | null>(null);
  const queuedFramesRef = useRef<LandmarkFrame[]>([]);
  const framesSeenRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastFrameRef = useRef<LandmarkFrame | null>(null);
  const idleFramesRef = useRef(0);
  const hasMovedRef = useRef(false);
  const endpointedRef = useRef(false);
  const generationRef = useRef(0);
  const latestPredictionRef = useRef<DetectionPrediction | null>(null);

  const resetLocalState = useCallback(() => {
    queuedFramesRef.current = [];
    framesSeenRef.current = 0;
    lastFrameRef.current = null;
    idleFramesRef.current = 0;
    hasMovedRef.current = false;
  }, []);

  const maybeFinalizeSegment = useCallback((sessionId: string) => {
    const latest = latestPredictionRef.current;
    if (latest && latest.text.trim().length >= 2) {
      useDetectionsStore.getState().pushPrediction(latest);
    }

    endpointedRef.current = true;
    generationRef.current += 1;
    latestPredictionRef.current = null;
    resetLocalState();
    void resetInferenceSession(sessionId);
  }, [resetLocalState]);

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
      resetLocalState();
      if (sessionId) void deleteInferenceSession(sessionId);
    };
  }, [active, resetLocalState]);

  return useCallback((frame: HandLandmarksFrame) => {
    const sessionId = sessionIdRef.current;
    const payloadFrame = toInferenceFrame(frame);
    if (!sessionId) return;
    if (!payloadFrame) {
      if (!endpointedRef.current) maybeFinalizeSegment(sessionId);
      return;
    }

    const motion = frameMotion(lastFrameRef.current, payloadFrame);
    lastFrameRef.current = payloadFrame;
    const moving = motion >= motionThreshold;

    if (moving) {
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
        if (
          generation !== generationRef.current ||
          idleAtRequest >= idleFramesToFreezePrediction
        )
          return;
        const stableText = response.stable_text.trim();
        const partialText = response.partial_text.trim();
        const label = response.prediction.label.trim();
        const text = stableText.length >= 2 ? stableText : partialText || label;
        if (text.trim().length < 2) return;
        const prediction = {
          text,
          confidence: response.prediction.confidence,
          processingTimeMs: performance.now() - startedAt,
        };
        latestPredictionRef.current = prediction;
        useDetectionsStore.getState().setCurrentPrediction(prediction);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [maybeFinalizeSegment, resetLocalState]);
}

function frameMotion(previous: LandmarkFrame | null, current: LandmarkFrame) {
  if (!previous) return 0;
  let total = 0;
  const count = Math.min(21, previous.landmarks.length, current.landmarks.length);
  for (let i = 0; i < count; i += 1) {
    const a = previous.landmarks[i];
    const b = current.landmarks[i];
    total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return total / count;
}
