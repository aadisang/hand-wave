import { DownloadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cfg } from "@hand-wave/contract";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
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
      <Surface
        className="pointer-events-auto font-mono text-xs leading-relaxed"
        padding="sm"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Dev</span>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => {
                if (recording) {
                  stopRecording();
                  setBatchIndex(null);
                  return;
                }
                startRecording(prompt("Trace label")?.trim() || "unlabeled");
              }}
              size="xs"
              variant={recording ? "destructive" : "outline"}
            >
              {recording ? "Stop" : "Rec"}
            </Button>
            <Button
              disabled={!canExport}
              onClick={() => downloadTraces(traces, exportRecordings)}
              size="xs"
              variant="outline"
            >
              <DownloadIcon className="size-3" />
              Trace
            </Button>
          </div>
        </div>
        <div className="mb-2 space-y-1.5 border-b pb-2">
          <textarea
            aria-label="Trace batch labels"
            className="h-16 w-full resize-none rounded-md border border-input bg-background/70 px-2 py-1 text-foreground outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
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
              <Button
                disabled={!canStartBatch}
                onClick={startBatch}
                size="xs"
                variant="outline"
              >
                Start
              </Button>
              <Button
                disabled={batchIndex === null || !recording}
                onClick={nextBatchLabel}
                size="xs"
                variant="outline"
              >
                Next
              </Button>
              <Button
                disabled={batchIndex === null && !recording}
                onClick={finishBatch}
                size="xs"
                variant="outline"
              >
                Finish
              </Button>
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
      </Surface>
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
