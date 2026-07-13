import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useDetectionsStore } from "@/stores/detections-store";

const pulse = { opacity: [0.4, 0.85, 0.4] };
const pulseTransition = {
  duration: 1.6,
  ease: "easeInOut" as const,
  repeat: Number.POSITIVE_INFINITY,
};

export function StatusDot() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const shouldReduceMotion = useReducedMotion();
  const committed = prediction?.committed ?? false;

  return (
    <LazyMotion features={domAnimation}>
      <m.span
        animate={
          committed || shouldReduceMotion
            ? { opacity: committed ? 1 : 0.6 }
            : pulse
        }
        aria-hidden
        className={cn(
          // Stage-scoped color: the stage is always dark regardless of theme.
          "block size-1.5 rounded-full",
          committed ? "bg-white/90" : "bg-white/60",
        )}
        transition={
          committed || shouldReduceMotion ? { duration: 0.2 } : pulseTransition
        }
      />
    </LazyMotion>
  );
}
