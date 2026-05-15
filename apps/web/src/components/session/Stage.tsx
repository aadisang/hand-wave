import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { useFullscreen } from "@/hooks/use-fullscreen";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";
import { predictFrames, type LandmarkFrame } from "@/inference";
import { toInferenceFrame } from "@/landmarks";
import { cn } from "@/lib/utils";
import { useDetectionsStore } from "@/stores/detections-store";
import { DevPanel } from "./DevPanel";
import { HandLandmarksOverlay } from "./HandLandmarksOverlay";
import { IdleStage } from "./IdleStage";
import { PredictionOverlay } from "./PredictionOverlay";
import { StreamToolbar } from "./StreamToolbar";

export function Stage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const capture = useCaptureSession();
  const fullscreen = useFullscreen(stageRef);
  const pushPrediction = useDetectionsStore((s) => s.pushPrediction);
  const clipFramesRef = useRef<LandmarkFrame[]>([]);
  const [bufferedFrames, setBufferedFrames] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);

  const { state } = capture;
  const isLiveCamera = state.status === "live" && state.kind === "camera";

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject =
        state.status === "live" ? state.stream : null;
    }
  }, [state]);

  useEffect(() => {
    if (!isLiveCamera) {
      clipFramesRef.current = [];
      setBufferedFrames(0);
      setIsRecording(false);
      setIsDecoding(false);
    }
  }, [isLiveCamera]);

  const onLandmarksFrame = useCallback(
    (frame: HandLandmarksFrame) => {
      if (!isRecording) return;
      const next = toInferenceFrame(frame);
      if (!next) return;
      const updated = [...clipFramesRef.current, next].slice(-384);
      clipFramesRef.current = updated;
      setBufferedFrames(updated.length);
    },
    [isRecording],
  );

  const decodeFrames = useCallback((frames: LandmarkFrame[]) => {
    if (frames.length < 24 || isDecoding) return;
    setIsDecoding(true);
    const startedAt = performance.now();

    void predictFrames(frames)
      .then((response) => {
        const text =
          response.stable_text ||
          response.partial_text ||
          response.prediction.label;
        if (!text.trim()) return;
        pushPrediction({
          text,
          confidence: response.prediction.confidence,
          processingTimeMs: performance.now() - startedAt,
        });
      })
      .finally(() => setIsDecoding(false));
  }, [isDecoding, pushPrediction]);

  const decodeClip = useCallback(() => {
    decodeFrames(clipFramesRef.current);
  }, [decodeFrames]);

  const clip = useMemo(
    () => ({
      bufferedFrames,
      isDecoding,
      isRecording,
      startRecording: () => {
        clipFramesRef.current = [];
        setBufferedFrames(0);
        setIsRecording(true);
      },
      stopRecording: () => setIsRecording(false),
      stopAndDecode: () => {
        setIsRecording(false);
        decodeFrames(clipFramesRef.current);
      },
      decode: decodeClip,
    }),
    [bufferedFrames, decodeClip, decodeFrames, isDecoding, isRecording],
  );

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden border bg-stage",
        fullscreen.isFullscreen ? "rounded-none" : "rounded-2xl",
      )}
    >
      {state.status === "live" || state.status === "starting" ? (
        <video
          ref={videoRef}
          aria-label={
            state.kind === "camera" ? "Camera preview" : "Screen preview"
          }
          autoPlay
          className={cn(
            "h-full w-full bg-stage",
            state.kind === "camera"
              ? "object-cover -scale-x-100"
              : "object-contain",
          )}
          muted
          playsInline
        />
      ) : (
        <IdleStage error={state.status === "error" ? state.message : null} />
      )}
      {state.status === "live" && state.kind === "camera" && (
        <>
          <HandLandmarksOverlay
            active={state.status === "live" && state.kind === "camera"}
            onFrame={onLandmarksFrame}
            videoRef={videoRef}
          />
          <PredictionOverlay />
        </>
      )}
      <DevPanel />
      <StreamToolbar capture={capture} clip={clip} fullscreen={fullscreen} />
    </div>
  );
}
