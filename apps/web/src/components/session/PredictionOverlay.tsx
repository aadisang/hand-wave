import { useDetectionsStore } from "@/stores/detections-store";

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);

  if (!prediction) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-10">
      <div className="max-w-[min(32rem,calc(100vw-3rem))] rounded-lg border bg-overlay px-3 py-2 shadow-sm backdrop-blur-sm">
        <span className="block truncate font-bold text-3xl">
          {prediction.text}
        </span>
      </div>
    </div>
  );
}
