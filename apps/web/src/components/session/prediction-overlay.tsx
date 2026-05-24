import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { useDetectionsStore } from "@/stores/detections-store";

const easeOut = [0.23, 1, 0.32, 1] as const;
const hidden = { opacity: 0 };
const shown = { opacity: 1 };

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: easeOut };

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence>
        {prediction ? (
          <m.div
            animate={shown}
            className="inline-flex max-w-dev-panel min-w-0 items-center rounded-xl border bg-toolbar px-3 py-2 text-card-foreground shadow-sm backdrop-blur-md"
            exit={hidden}
            initial={shouldReduceMotion ? false : hidden}
            transition={transition}
          >
            <span className="min-w-0 truncate font-semibold text-base">
              {prediction.text}
            </span>
          </m.div>
        ) : null}
      </AnimatePresence>
    </LazyMotion>
  );
}
