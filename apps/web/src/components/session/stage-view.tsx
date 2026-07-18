import { useFullscreen } from "@reactuses/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { useInfer } from "@/hooks/use-infer";
import { cn } from "@/lib/utils";
import { useLandmarksStore } from "@/stores/landmarks-store";
import { useDevStore } from "@/stores/dev-store";
import { DevPanel } from "./dev-panel";
import { LandmarksOverlay } from "./landmarks-overlay";
import { IdleStage } from "./idle-stage";
import { PredictionOverlay } from "./prediction-overlay";
import { StatusDot } from "./status-dot";
import { StreamToolbar } from "./stream-toolbar";

export function Stage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const capture = useCaptureSession();
  const [full, fullCtrl] = useFullscreen(stageRef);
  const drawLandmarks = useLandmarksStore((s) => s.draw);
  const inferenceBoundary = useDevStore((s) => s.boundary);

  const { state } = capture;
  const isLive = state.status === "live";
  const onLandmarksFrame = useInfer(
    isLive ? state.frameRate : null,
    inferenceBoundary,
  );

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject =
        state.status === "live" ? state.stream : null;
    }
  }, [state]);

  // Reveal the controls on pointer activity and fade them back out after a
  // short lull, so the captions have the stage during a demo.
  const [controlsRevealed, setControlsRevealed] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const nextRefreshRef = useRef(0);
  const bumpControls = useCallback(() => {
    setControlsRevealed(true);

    const now = performance.now();
    if (now < nextRefreshRef.current) return;

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(
      () => setControlsRevealed(false),
      2600,
    );
    nextRefreshRef.current = now + 250;
  }, []);
  const hideControls = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    nextRefreshRef.current = 0;
    setControlsRevealed(false);
  }, []);
  useEffect(
    () => () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      nextRefreshRef.current = 0;
    },
    [],
  );

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden border bg-stage shadow-stage outline outline-1 -outline-offset-1 outline-white/10",
        full ? "rounded-none" : "rounded-2xl",
      )}
      onPointerDown={bumpControls}
      onPointerLeave={hideControls}
      onPointerMove={bumpControls}
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
      {state.status === "live" && (
        <LandmarksOverlay
          captureKind={state.kind}
          draw={drawLandmarks}
          onFrame={onLandmarksFrame}
          videoRef={videoRef}
        />
      )}
      <div className="pointer-events-none absolute top-4 left-4 z-20 max-w-dev-panel">
        <DevPanel live={isLive} />
      </div>
      {state.status === "live" && (
        <div className="pointer-events-none absolute top-4 right-4 z-20 flex h-2 items-center">
          <StatusDot />
        </div>
      )}
      {state.status === "live" && (
        <div className="pointer-events-none absolute right-0 bottom-16 left-0 z-20 flex justify-center px-4 sm:bottom-20 sm:px-8">
          <PredictionOverlay />
        </div>
      )}
      <StreamToolbar
        capture={capture}
        full={full}
        onFull={fullCtrl.toggleFullscreen}
        revealed={controlsRevealed}
      />
    </div>
  );
}
