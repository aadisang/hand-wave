import { useDetectionsStore } from "@/stores/detections-store";

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);

  if (!prediction) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-20 w-dev-panel max-w-full">
      <div className="rounded-lg border bg-overlay p-3 font-mono text-foreground text-xs leading-relaxed shadow-sm backdrop-blur-sm">
        <div className="truncate font-semibold text-base">
          {prediction.text}
        </div>
      </div>
    </div>
  );
}
