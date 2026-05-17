import { useFullscreenElement } from "@mantine/hooks";
import { useEffect, useRef } from "react";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { useInferenceSession } from "@/hooks/use-inference-session";
import { cn } from "@/lib/utils";
import { DevPanel } from "./dev-panel";
import { HandLandmarksOverlay } from "./hand-landmarks-overlay";
import { IdleStage } from "./idle-stage";
import { PredictionOverlay } from "./prediction-overlay";
import { StreamToolbar } from "./stream-toolbar";

export function Stage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const capture = useCaptureSession();
  const fullscreen = useFullscreenElement<HTMLDivElement>();

  const { state } = capture;
  const isLive = state.status === "live";
  const onLandmarksFrame = useInferenceSession(isLive);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject =
        state.status === "live" ? state.stream : null;
    }
  }, [state]);

  return (
    <div
      ref={fullscreen.ref}
      className={cn(
        "relative aspect-video w-full overflow-hidden border bg-stage",
        fullscreen.fullscreen ? "rounded-none" : "rounded-2xl",
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
          <HandLandmarksOverlay
            active={isLive}
            fit={state.kind === "camera" ? "cover" : "contain"}
            mirrored={state.kind === "camera"}
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
