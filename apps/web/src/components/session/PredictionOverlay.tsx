import { Badge } from "@/components/ui/badge";
import { useDetectionsStore } from "@/stores/detections-store";

export function PredictionOverlay() {
  const prediction = useDetectionsStore((s) => s.currentPrediction);

  if (!prediction) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute top-4 right-4 z-10">
      <div className="flex items-center gap-2 rounded-lg border bg-overlay px-3 py-2 shadow-sm backdrop-blur-sm">
        <span className="font-bold text-3xl">{prediction.text}</span>
        <div className="flex flex-col gap-1">
          <Badge className="text-xs" variant="secondary">
            {(prediction.confidence * 100).toFixed(0)}%
          </Badge>
          <Badge className="text-xs" variant="outline">
            {prediction.processingTimeMs.toFixed(0)}ms
          </Badge>
        </div>
      </div>
    </div>
  );
}
