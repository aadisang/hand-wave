import { DownloadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cfg } from "@hand-wave/contract";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { useDevStore } from "@/stores/dev-store";
import type { DevRecording, DevTrace } from "@/types/dev";

type Props = {
  live: boolean;
  trackFps: number | null;
};

export function DevPanel({ live, trackFps }: Props) {
  const enabled = useDevStore((s) => s.enabled);

  if (!enabled) return null;

  return <DevPanelContent live={live} trackFps={trackFps} />;
}

function DevPanelContent({ live, trackFps }: Props) {
  const frame = useDevStore((s) => s.frame);
  const pipelineFps = useDevStore((s) => s.pipelineFps);
  const poseFps = useDevStore((s) => s.poseFps);
  const presentedFps = useDevStore((s) => s.presentedFps);
  const detectorRoundTripMs = useDevStore((s) => s.detectorRoundTripMs);
  const inferenceMs = useDevStore((s) => s.inferenceMs);
  const poseRoundTripMs = useDevStore((s) => s.poseRoundTripMs);
  const poseInferenceMs = useDevStore((s) => s.poseInferenceMs);
  const traces = useDevStore((s) => s.traces);
  const recording = useDevStore((s) => s.recording);
  const recordings = useDevStore((s) => s.recordings);
  const startRecording = useDevStore((s) => s.startRecording);
  const stopRecording = useDevStore((s) => s.stopRecording);
  const markBoundary = useDevStore((s) => s.markBoundary);
  const [batchText, setBatchText] = useState("");
  const [batchIndex, setBatchIndex] = useState<number | null>(null);
  const batchLabels = useMemo(() => parseBatchLabels(batchText), [batchText]);
  const canExport = !recording && (traces.length > 0 || recordings.length > 0);
  const canStartBatch = live && batchLabels.length > 0 && !recording;
  const batchActive = recording !== null;
  const batchStatus = recording
    ? `Recording ${(batchIndex ?? 0) + 1} of ${batchLabels.length}: ${recording.label}`
    : !live
      ? "Start a stream to record"
      : recordings.length > 0
        ? `${recordings.length} recording${recordings.length === 1 ? "" : "s"} ready to export`
        : batchLabels.length > 0
          ? `${batchLabels.length} label${batchLabels.length === 1 ? "" : "s"} ready`
          : "Add one label per line";
  const batchAction = batchActive
    ? batchIndex === batchLabels.length - 1
      ? "Finish recording"
      : "Save & next"
    : "Start recording";

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
  useEffect(() => {
    if (live || !recording) return;
    stopRecording();
    markBoundary();
  }, [live, markBoundary, recording, stopRecording]);

  const startBatch = () => {
    if (!canStartBatch) return;
    markBoundary();
    setBatchIndex(0);
    startRecording(batchLabels[0]);
  };
  const nextBatchLabel = () => {
    if (batchIndex === null) return;
    stopRecording();
    markBoundary();
    const nextIndex = batchIndex + 1;
    if (nextIndex >= batchLabels.length) {
      setBatchIndex(null);
      return;
    }
    setBatchIndex(nextIndex);
    startRecording(batchLabels[nextIndex]);
  };

  return (
    <div className="pointer-events-none w-dev-panel max-w-full">
      <Surface
        className="pointer-events-auto font-mono text-xs leading-relaxed"
        padding="sm"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Dev</span>
          <Button
            disabled={!canExport}
            onClick={() => downloadTraces(traces, recordings)}
            size="xs"
            variant="outline"
          >
            <DownloadIcon className="size-3" />
            Export
          </Button>
        </div>
        <div className="mb-2 space-y-1.5 border-b pb-2">
          <textarea
            aria-label="Trace batch labels"
            className="h-trace-input w-full resize-none rounded-md border border-input bg-background/70 px-2 py-1 text-foreground outline-none transition duration-150 ease-out focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
            disabled={batchActive}
            onChange={(event) => setBatchText(event.currentTarget.value)}
            placeholder="one label per line"
            spellCheck={false}
            value={batchText}
          />
          <div className="flex items-center justify-between gap-2">
            <span
              aria-live="polite"
              className="min-w-0 truncate text-muted-foreground"
            >
              {batchStatus}
            </span>
            <Button
              disabled={batchActive ? !recording : !canStartBatch}
              onClick={batchActive ? nextBatchLabel : startBatch}
              size="xs"
              variant={batchActive ? "default" : "outline"}
            >
              {batchAction}
            </Button>
          </div>
        </div>
        <Row label="Track FPS" value={trackFps?.toFixed(1) ?? "-"} />
        <Row label="Presented FPS" value={presentedFps.toFixed(1)} />
        <Row label="Hand FPS" value={pipelineFps.toFixed(1)} />
        <Row label="Pose FPS" value={poseFps.toFixed(1)} />
        <Row
          label="Hand round trip"
          value={`${detectorRoundTripMs.toFixed(1)} ms`}
        />
        <Row label="Hand inference" value={`${inferenceMs.toFixed(1)} ms`} />
        <Row
          label="Pose round trip"
          value={`${poseRoundTripMs.toFixed(1)} ms`}
        />
        <Row
          label="Pose inference"
          value={`${poseInferenceMs.toFixed(1)} ms`}
        />
        <Row label="Hands" value={hands.length.toString()} />
        <Row label="Pose" value={poseCount.toString()} />
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
