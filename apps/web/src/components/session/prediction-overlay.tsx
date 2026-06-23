import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { surfaceVariants } from "@/components/ui/surface-variants";
import { cn } from "@/lib/utils";
import { useDetectionsStore } from "@/stores/detections-store";

const easeOut = [0.23, 1, 0.32, 1] as const;
const hidden = { filter: "blur(4px)", opacity: 0, scale: 0.98, y: -4 };
const shown = { filter: "blur(0px)", opacity: 1, scale: 1, y: 0 };
const instantTransition = { duration: 0 };
const visibleTransition = { duration: 0.16, ease: easeOut };

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
            className={cn(
              surfaceVariants(),
              "inline-flex max-w-dev-panel min-w-0 items-center px-3 py-2",
            )}
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
