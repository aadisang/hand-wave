import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { cn } from "@/lib/utils";
import { useDetectionsStore } from "@/stores/detections-store";

const easeOut = [0.23, 1, 0.32, 1] as const;
const hidden = { filter: "blur(4px)", opacity: 0, y: 6 };
const shown = { filter: "blur(0px)", opacity: 1, y: 0 };
const instantTransition = { duration: 0 };
const visibleTransition = { duration: 0.2, ease: easeOut };

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const shouldReduceMotion = useReducedMotion();
  const transition = shouldReduceMotion ? instantTransition : visibleTransition;

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence initial={false}>
        {prediction ? (
          <m.div
            animate={shown}
            aria-hidden="true"
            className={cn(
              "max-w-[min(42rem,100%)] rounded-xl px-4 py-2.5 text-center",
              "bg-black/60 shadow-[0_1px_2px_rgba(0,0,0,0.45),0_12px_32px_rgba(0,0,0,0.28)]",
              "outline outline-1 -outline-offset-1 backdrop-blur-md",
              "transition-[background-color,box-shadow,color,outline-color] duration-200",
              prediction.committed
                ? "text-white outline-white/14"
                : "bg-black/45 text-white/70 outline-white/8",
            )}
            exit={hidden}
            initial={shouldReduceMotion ? false : hidden}
            transition={transition}
          >
            <span className="text-pretty font-heading font-medium text-[clamp(1rem,2.2vw,1.375rem)] leading-snug tracking-[-0.01em]">
              {prediction.text}
              {!prediction.committed && (
                <m.span
                  animate={
                    shouldReduceMotion
                      ? { opacity: 0.65 }
                      : { opacity: [0.3, 0.9, 0.3] }
                  }
                  className="ml-1 inline-block h-[0.85em] w-px translate-y-[0.08em] bg-current"
                  transition={
                    shouldReduceMotion
                      ? instantTransition
                      : {
                          duration: 1.1,
                          ease: "easeInOut",
                          repeat: Number.POSITIVE_INFINITY,
                        }
                  }
                />
              )}
            </span>
          </m.div>
        ) : null}
      </AnimatePresence>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {prediction?.committed ? prediction.text : ""}
      </span>
    </LazyMotion>
  );
}
