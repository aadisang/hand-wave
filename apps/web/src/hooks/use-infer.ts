import { useCallback, useEffect, useRef } from "react";
import { createStreamCtrl } from "@/lib/inference/stream";
import type { Frame, StreamCtrl } from "@/types/inference";

export function useInfer(active: boolean) {
  const ctrlRef = useRef<StreamCtrl | null>(null);

  useEffect(() => {
    if (!active) return;

    const ctrl = createStreamCtrl();
    ctrlRef.current = ctrl;
    ctrl.start();

    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, [active]);

  return useCallback((frame: Frame | null) => {
    ctrlRef.current?.accept(frame);
  }, []);
}
