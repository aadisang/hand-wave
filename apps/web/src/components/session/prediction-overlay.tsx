import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { surfaceVariants } from "@/components/ui/surface-variants";
import { duration, easeOut } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useDetectionsStore } from "@/stores/detections-store";

const hidden = { opacity: 0, transform: "translate3d(0, 6px, 0)" };
const shown = { opacity: 1, transform: "translate3d(0, 0, 0)" };
const reducedMotionHidden = { opacity: 0 };
const reducedMotionShown = { opacity: 1 };
const transition = { duration: duration.overlay, ease: easeOut };

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const shouldReduceMotion = useReducedMotion();
  const motionState = shouldReduceMotion ? reducedMotionShown : shown;
  const exitState = shouldReduceMotion ? reducedMotionHidden : hidden;
  const initialState = shouldReduceMotion ? reducedMotionHidden : hidden;

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {prediction ? (
          <m.p
            animate={motionState}
            aria-hidden="true"
            className={cn(
              surfaceVariants(),
              "max-w-[40rem] px-5 py-3 text-center text-[clamp(1.25rem,3.2vw,2rem)] font-semibold leading-tight tracking-[-0.02em] text-balance text-white",
            )}
            exit={exitState}
            initial={initialState}
            transition={transition}
          >
            {prediction.text}
          </m.p>
        ) : null}
      </AnimatePresence>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {prediction?.committed ? prediction.text : ""}
      </span>
    </LazyMotion>
  );
}
