import { useCallback, useEffect, useRef } from "react";
import {
  appendInferenceFrames,
  createInferenceSession,
  deleteInferenceSession,
  type LandmarkFrame,
} from "@/inference";
import { toInferenceFrame } from "@/landmarks";
import { useDetectionsStore } from "@/stores/detections-store";
import type { HandLandmarksFrame } from "./use-hand-landmarker";

const minDecodeFrames = 72;
const strideFrames = 12;

export function useInferenceSession(active: boolean) {
  const sessionIdRef = useRef<string | null>(null);
  const queuedFramesRef = useRef<LandmarkFrame[]>([]);
  const framesSeenRef = useRef(0);
  const inFlightRef = useRef(false);

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
      queuedFramesRef.current = [];
      framesSeenRef.current = 0;
      if (sessionId) void deleteInferenceSession(sessionId);
    };
  }, [active]);

  return useCallback((frame: HandLandmarksFrame) => {
    const sessionId = sessionIdRef.current;
    const payloadFrame = toInferenceFrame(frame);
    if (!sessionId || !payloadFrame) return;

    queuedFramesRef.current.push(payloadFrame);
    framesSeenRef.current += 1;

    if (framesSeenRef.current < minDecodeFrames) return;
    if (framesSeenRef.current % strideFrames !== 0 || inFlightRef.current)
      return;

    const frames = queuedFramesRef.current.splice(0);
    inFlightRef.current = true;
    const startedAt = performance.now();

    void appendInferenceFrames(sessionId, frames)
      .then((response) => {
        const stableText = response.stable_text.trim();
        const partialText = response.partial_text.trim();
        const label = response.prediction.label.trim();
        const text = stableText.length >= 2 ? stableText : partialText || label;
        if (text.trim().length < 2) return;
        useDetectionsStore.getState().pushPrediction({
          text,
          confidence: response.prediction.confidence,
          processingTimeMs: performance.now() - startedAt,
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);
}
