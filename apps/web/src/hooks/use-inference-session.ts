import { useCallback, useEffect, useRef } from "react";
import { createInferenceStreamController } from "@/lib/inference/stream-controller";
import { toInferenceFrame } from "@/lib/mediapipe/landmarks";
import type { InferenceStreamController } from "@/types/inference";
import type { HandLandmarksFrame } from "./use-hand-landmarker";

export function useInferenceSession(active: boolean) {
  const controllerRef = useRef<InferenceStreamController | null>(null);

  useEffect(() => {
    if (!active) return;

    const controller = createInferenceStreamController();
    controllerRef.current = controller;
    void controller.start();

    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [active]);

  return useCallback((frame: HandLandmarksFrame) => {
    controllerRef.current?.accept(toInferenceFrame(frame));
  }, []);
}
