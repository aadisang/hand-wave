import { useCallback, useEffect, useRef } from "react";
import { createStreamCtrl } from "@/lib/inference/stream";
import { toFrame } from "@/lib/mediapipe/landmarks";
import type { StreamCtrl } from "@/types/inference";
import type { HandFrame } from "@/types/landmarks";

export function useInfer(active: boolean) {
  const ctrlRef = useRef<StreamCtrl | null>(null);

  useEffect(() => {
    if (!active) return;

    const ctrl = createStreamCtrl();
    ctrlRef.current = ctrl;
    void ctrl.start();

    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, [active]);

  return useCallback((frame: HandFrame) => {
    ctrlRef.current?.accept(toFrame(frame));
  }, []);
}
