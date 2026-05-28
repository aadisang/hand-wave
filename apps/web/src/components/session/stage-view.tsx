import { useFullscreen } from "@reactuses/core";
import { useEffect, useRef } from "react";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { useInfer } from "@/hooks/use-infer";
import { cn } from "@/lib/utils";
import { useLandmarksStore } from "@/stores/landmarks-store";
import { DevPanel } from "./dev-panel";
import { LandmarksOverlay } from "./landmarks-overlay";
import { IdleStage } from "./idle-stage";
import { PredictionOverlay } from "./prediction-overlay";
import { StreamToolbar } from "./stream-toolbar";

export function Stage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const capture = useCaptureSession();
  const [full, fullCtrl] = useFullscreen(stageRef);
  const drawLandmarks = useLandmarksStore((s) => s.draw);

  const { state } = capture;
  const isLive = state.status === "live";
  const onLandmarksFrame = useInfer(isLive);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject =
        state.status === "live" ? state.stream : null;
    }
  }, [state]);

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden border bg-stage",
        full ? "rounded-none" : "rounded-2xl",
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
      {state.status === "live" && (
        <>
          <LandmarksOverlay
            captureKind={state.kind}
            draw={drawLandmarks}
            onFrame={onLandmarksFrame}
            videoRef={videoRef}
          />
        </>
      )}
      <div className="pointer-events-none absolute top-4 left-4 z-20 max-w-dev-panel">
        <DevPanel />
      </div>
      {state.status === "live" && (
        <div className="pointer-events-none absolute top-4 right-4 z-20 flex max-w-dev-panel justify-end">
          <PredictionOverlay />
        </div>
      )}
      <StreamToolbar
        capture={capture}
        full={full}
        onFull={fullCtrl.toggleFullscreen}
      />
    </div>
  );
}
