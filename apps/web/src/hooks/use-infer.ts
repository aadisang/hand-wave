import { useCallback, useEffect, useRef } from "react";
import { createStreamCtrl } from "@/lib/inference/stream";
import type { Frame, StreamCtrl } from "@/types/inference";

export function useInfer(frameRate: number | null, boundary: number) {
  const ctrlRef = useRef<StreamCtrl | null>(null);

  useEffect(() => {
    if (frameRate === null) return;

    const ctrl = createStreamCtrl(frameRate);
    ctrlRef.current = ctrl;
    ctrl.start();

    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, [frameRate]);

  useEffect(() => {
    ctrlRef.current?.reset();
  }, [boundary]);

  return useCallback((frame: Frame | null) => {
    ctrlRef.current?.accept(frame);
  }, []);
}
