import { DownloadIcon } from "lucide-react";
import { useDevStore, type DevTrace } from "@/stores/dev-store";

export function DevPanel() {
  const { enabled, frame, fps, inferenceMs, traces } = useDevStore();

  if (!enabled) return null;

  const hands = [
    ...(frame?.rightHandLandmarks ?? []).map((landmarks) => ({
      label: "Right",
      landmarks,
    })),
    ...(frame?.leftHandLandmarks ?? []).map((landmarks) => ({
      label: "Left",
      landmarks,
    })),
  ];
  const poseCount = frame?.poseLandmarks[0]?.length ?? 0;

  return (
    <div className="pointer-events-none absolute top-4 left-4 z-20 w-dev-panel max-w-full">
      <div className="pointer-events-auto rounded-lg border bg-overlay p-3 font-mono text-foreground text-xs leading-relaxed shadow-sm backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Dev</span>
          <button
            className="inline-flex items-center gap-1 rounded border border-input px-1.5 py-0.5 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={traces.length === 0}
            onClick={() => downloadTraces(traces)}
            type="button"
          >
            <DownloadIcon className="size-3" />
            Trace
          </button>
        </div>
        <Row label="FPS" value={fps.toFixed(1)} />
        <Row label="Inference" value={`${inferenceMs.toFixed(1)} ms`} />
        <Row label="Hands" value={hands.length.toString()} />
        <Row label="Pose" value={poseCount.toString()} />
        <Row label="Trace" value={traces.length.toString()} />
        {hands.map((hand) => {
          const wrist = hand.landmarks[0];
          return (
            <div key={handKey(hand)} className="mt-1.5 border-t pt-1.5">
              <Row label="type" value={hand.label} />
              <Row label="pts" value={hand.landmarks.length.toString()} />
              {wrist ? (
                <Row
                  label="wrist"
                  value={`${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)}, ${wrist.z.toFixed(2)}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function downloadTraces(traces: DevTrace[]) {
  const blob = new Blob([JSON.stringify(traces, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `handwave-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function handKey(hand: {
  label: string;
  landmarks: { x: number; y: number }[];
}) {
  const wrist = hand.landmarks[0];
  return wrist
    ? `${hand.label}-${wrist.x.toFixed(3)}-${wrist.y.toFixed(3)}`
    : hand.label;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
