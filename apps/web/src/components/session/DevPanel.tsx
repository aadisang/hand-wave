import { useDevStore } from "@/stores/dev-store";

export function DevPanel() {
  const enabled = useDevStore((s) => s.enabled);
  const frame = useDevStore((s) => s.frame);
  const fps = useDevStore((s) => s.fps);
  const inferenceMs = useDevStore((s) => s.inferenceMs);

  if (!enabled) return null;

  const hands = frame?.landmarks ?? [];
  const handedness = frame?.handedness ?? [];

  return (
    <div className="pointer-events-none absolute top-4 left-4 z-20 w-dev-panel max-w-full">
      <div className="rounded-lg border bg-overlay p-3 font-mono text-foreground text-xs leading-relaxed shadow-sm backdrop-blur-sm">
        <Row label="FPS" value={fps.toFixed(1)} />
        <Row label="Inference" value={`${inferenceMs.toFixed(1)} ms`} />
        <Row label="Hands" value={hands.length.toString()} />
        {hands.map((hand, i) => {
          const meta = handedness[i]?.[0];
          const wrist = hand[0];
          return (
            <div key={i} className="mt-1.5 border-t pt-1.5">
              <Row
                label={`#${i}`}
                value={
                  meta
                    ? `${meta.categoryName} ${(meta.score * 100).toFixed(0)}%`
                    : "—"
                }
              />
              <Row label="pts" value={hand.length.toString()} />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
