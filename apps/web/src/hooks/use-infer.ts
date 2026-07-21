import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createStreamCtrl } from "@/lib/inference/stream";
import {
  getInferenceConnectionStatus,
  subscribeInferenceConnection,
} from "@/lib/inference/connection";
import type { Frame, StreamCtrl } from "@/types/inference";

export function useInfer(frameRate: number | null, boundary: number) {
  const ctrlRef = useRef<StreamCtrl | null>(null);
  const connectionStatus = useSyncExternalStore(
    subscribeInferenceConnection,
    getInferenceConnectionStatus,
    getInferenceConnectionStatus,
  );

  useEffect(() => {
    if (frameRate === null) return;

    const ctrl = createStreamCtrl(frameRate);
    ctrlRef.current = ctrl;
    void ctrl.start();

    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, [frameRate]);

  useEffect(() => {
    ctrlRef.current?.reset();
  }, [boundary]);

  const accept = useCallback((frame: Frame | null) => {
    ctrlRef.current?.accept(frame);
  }, []);

  return {
    accept,
    status: frameRate === null ? "idle" : connectionStatus,
  };
}
