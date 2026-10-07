import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createStreamCtrl } from "@/lib/inference/stream";
import {
  getInferenceConnectionStatus,
  subscribeInferenceConnection,
} from "@/lib/inference/connection";
import type { Frame, InferenceMode, StreamCtrl } from "@/types/inference";

export function useInfer(live: boolean, boundary: number, mode: InferenceMode) {
  const ctrlRef = useRef<StreamCtrl | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => subscribeInferenceConnection(mode, listener),
    [mode],
  );
  const getSnapshot = useCallback(
    () => getInferenceConnectionStatus(mode),
    [mode],
  );
  const connectionStatus = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    if (!live) return;

    const ctrl = createStreamCtrl(mode);
    ctrlRef.current = ctrl;
    void ctrl.start();

    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, [live, mode]);

  useEffect(() => {
    ctrlRef.current?.reset();
  }, [boundary]);

  const accept = useCallback((frame: Frame | null) => {
    ctrlRef.current?.accept(frame);
  }, []);

  return {
    accept,
    connectionStatus,
    status: live ? connectionStatus : "idle",
  };
}
