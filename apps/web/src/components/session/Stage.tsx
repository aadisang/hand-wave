import { useEffect, useRef } from "react";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useInferenceSession } from "@/hooks/use-inference-session";
import { cn } from "@/lib/utils";
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

  const { state } = capture;
  const isLiveCamera = state.status === "live" && state.kind === "camera";
  const onLandmarksFrame = useInferenceSession(isLiveCamera);

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
      <StreamToolbar capture={capture} fullscreen={fullscreen} />
    </div>
  );
}
