import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { useDetectionsStore } from "@/stores/detections-store";

const easeOut = [0.23, 1, 0.32, 1] as const;

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: easeOut };

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="popLayout">
        {prediction ? (
          <m.div
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            className="inline-flex max-w-dev-panel min-w-0 origin-top-right items-center rounded-xl border bg-toolbar px-3 py-2 text-card-foreground shadow-sm backdrop-blur-md"
            exit={{
              opacity: 0,
              transform: "translateY(-4px) scale(0.98)",
            }}
            initial={
              shouldReduceMotion
                ? false
                : { opacity: 0, transform: "translateY(-4px) scale(0.98)" }
            }
            layout
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
