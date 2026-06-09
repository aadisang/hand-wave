import { DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cfg } from "@hand-wave/contract";
import { useDevStore } from "@/stores/dev-store";
import type { DevRecording, DevTrace } from "@/types/dev";

export function DevPanel() {
  const enabled = useDevStore((s) => s.enabled);

  if (!enabled) return null;

  return <DevPanelContent />;
}

function DevPanelContent() {
  const frame = useDevStore((s) => s.frame);
  const fps = useDevStore((s) => s.fps);
  const inferenceMs = useDevStore((s) => s.inferenceMs);
  const traces = useDevStore((s) => s.traces);
  const recording = useDevStore((s) => s.recording);
  const recordings = useDevStore((s) => s.recordings);
  const startRecording = useDevStore((s) => s.startRecording);
  const stopRecording = useDevStore((s) => s.stopRecording);
  const resetTraceCapture = useDevStore((s) => s.resetTraceCapture);
  const [batchText, setBatchText] = useState("");
  const [batchIndex, setBatchIndex] = useState<number | null>(null);
  const batchLabels = useMemo(() => parseBatchLabels(batchText), [batchText]);
  const activeBatchLabel =
    batchIndex === null ? null : (batchLabels[batchIndex] ?? null);
  const exportRecordings = recording ? [...recordings, recording] : recordings;
  const canExport = traces.length > 0 || exportRecordings.length > 0;
  const canStartBatch = batchLabels.length > 0 && !recording;
  const batchProgress =
    batchIndex === null ? "" : `${batchIndex + 1}/${batchLabels.length}`;

  const hands = [
    ...(frame?.rightHandLandmarks ?? []).map((landmarks, index) => ({
      id: `right-${index}`,
      label: "Right",
      landmarks,
    })),
    ...(frame?.leftHandLandmarks ?? []).map((landmarks, index) => ({
      id: `left-${index}`,
      label: "Left",
      landmarks,
    })),
  ];
  const poseCount = frame?.poseLandmarks[0]?.length ?? 0;
  const startBatch = () => {
    if (!canStartBatch) return;
    resetTraceCapture();
    setBatchIndex(0);
    startRecording(batchLabels[0]);
  };
  const nextBatchLabel = () => {
    if (batchIndex === null) return;
    stopRecording();
    const nextIndex = batchIndex + 1;
    if (nextIndex >= batchLabels.length) {
      setBatchIndex(null);
      return;
    }
    setBatchIndex(nextIndex);
    startRecording(batchLabels[nextIndex]);
  };
  const finishBatch = () => {
    if (recording) stopRecording();
    setBatchIndex(null);
  };

  return (
    <div className="pointer-events-none w-dev-panel max-w-full">
      <div className="pointer-events-auto rounded-xl border bg-toolbar p-3 font-mono text-card-foreground text-xs leading-relaxed shadow-sm backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Dev</span>
          <div className="flex items-center gap-1">
            <button
              className={[
                "inline-flex items-center rounded border border-input px-1.5 py-0.5 transition-colors hover:bg-accent",
                recording
                  ? "bg-destructive text-destructive-foreground"
                  : "text-foreground",
              ].join(" ")}
              onClick={() => {
                if (recording) {
                  stopRecording();
                  setBatchIndex(null);
                  return;
                }
                startRecording(prompt("Trace label")?.trim() || "unlabeled");
              }}
              type="button"
            >
              {recording ? "Stop" : "Rec"}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-input px-1.5 py-0.5 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canExport}
              onClick={() => downloadTraces(traces, exportRecordings)}
              type="button"
            >
              <DownloadIcon className="size-3" />
              Trace
            </button>
          </div>
        </div>
        <div className="mb-2 space-y-1.5 border-b pb-2">
          <textarea
            aria-label="Trace batch labels"
            className="h-16 w-full resize-none rounded border border-input bg-background/70 px-2 py-1 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(event) => setBatchText(event.currentTarget.value)}
            placeholder="one label per line"
            spellCheck={false}
            value={batchText}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-muted-foreground">
              {activeBatchLabel
                ? `${batchProgress} ${activeBatchLabel}`
                : `${batchLabels.length} queued`}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                className="inline-flex items-center rounded border border-input px-1.5 py-0.5 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canStartBatch}
                onClick={startBatch}
                type="button"
              >
                Start
              </button>
              <button
                className="inline-flex items-center rounded border border-input px-1.5 py-0.5 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={batchIndex === null || !recording}
                onClick={nextBatchLabel}
                type="button"
              >
                Next
              </button>
              <button
                className="inline-flex items-center rounded border border-input px-1.5 py-0.5 text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={batchIndex === null && !recording}
                onClick={finishBatch}
                type="button"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
        <Row label="FPS" value={fps.toFixed(1)} />
        <Row label="Inference" value={`${inferenceMs.toFixed(1)} ms`} />
        <Row label="Hands" value={hands.length.toString()} />
        <Row label="Pose" value={poseCount.toString()} />
        <Row label="Trace" value={traces.length.toString()} />
        <Row
          label="Frames"
          value={(recording?.frames.length ?? 0).toString()}
        />
        <Row label="Clips" value={exportRecordings.length.toString()} />
        {hands.map((hand) => {
          const wrist = hand.landmarks[0];
          return (
            <div key={hand.id} className="mt-1.5 border-t pt-1.5">
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

function parseBatchLabels(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const label = line.trim();
    return label ? [label] : [];
  });
}

function downloadTraces(traces: DevTrace[], recordings: DevRecording[]) {
  const blob = new Blob(
    [JSON.stringify(createTraceExport(traces, recordings), null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `handwave-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function createTraceExport(traces: DevTrace[], recordings: DevRecording[]) {
  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    config: cfg,
    userAgent: navigator.userAgent,
    traces,
    recordings,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
