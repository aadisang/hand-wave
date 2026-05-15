import { useDevStore } from "@/stores/dev-store";

export function DevPanel() {
  const enabled = useDevStore((s) => s.enabled);
  const frame = useDevStore((s) => s.frame);
  const fps = useDevStore((s) => s.fps);
  const inferenceMs = useDevStore((s) => s.inferenceMs);

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
      <div className="rounded-lg border bg-overlay p-3 font-mono text-foreground text-xs leading-relaxed shadow-sm backdrop-blur-sm">
        <Row label="FPS" value={fps.toFixed(1)} />
        <Row label="Inference" value={`${inferenceMs.toFixed(1)} ms`} />
        <Row label="Hands" value={hands.length.toString()} />
        <Row label="Pose" value={poseCount.toString()} />
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

function handKey(hand: { label: string; landmarks: { x: number; y: number }[] }) {
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
