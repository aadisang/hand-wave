import {
  Bug,
  CircleStop,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Share2,
  Star,
  Video,
} from "lucide-react";
import { memo, useCallback, type ReactElement } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CaptureSession } from "@/types/capture";
import { useDevStore } from "@/stores/dev-store";
import { useLandmarksStore } from "@/stores/landmarks-store";
import { CameraSelect } from "./camera-select";

const repositoryUrl = "https://github.com/sinarck/hand-wave";

type Props = {
  capture: CaptureSession;
  full: boolean;
  onFull: () => void;
};

export const StreamToolbar = memo(function StreamToolbar({
  capture,
  full,
  onFull,
}: Props) {
  const devEnabled = useDevStore((s) => s.enabled);
  const toggleDev = useDevStore((s) => s.toggle);
  const drawLandmarks = useLandmarksStore((s) => s.draw);
  const toggleLandmarks = useLandmarksStore((s) => s.toggleDraw);
  const { cameraId, setCameraId, start, state, stop } = capture;
  const startScreen = useCallback(() => start("screen"), [start]);
  const startCamera = useCallback(() => start("camera"), [start]);
  const isCapturing = state.status === "live" || state.status === "starting";
  const isCamera = isCapturing && state.kind === "camera";
  const landmarksLabel = drawLandmarks ? "Hide landmarks" : "Show landmarks";
  const devLabel = devEnabled ? "Hide dev panel" : "Show dev panel";
  const fullLabel = full ? "Exit fullscreen" : "Enter fullscreen";

  return (
    <div className="absolute right-0 bottom-4 left-0 z-20 flex justify-center px-3 sm:bottom-5">
      <TooltipProvider delay={350}>
        <Toolbar
          aria-label="Stream controls"
          className="h-control-center items-center gap-1 bg-toolbar px-1.5 py-1 backdrop-blur-md"
        >
          <ToolbarGroup>
            {isCapturing ? (
              <ControlTooltip label="Stop sharing">
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="Stop sharing"
                      onClick={stop}
                      size="icon-sm"
                      variant="destructive"
                    />
                  }
                >
                  <CircleStop />
                </TooltipTrigger>
              </ControlTooltip>
            ) : (
              <>
                <ControlTooltip label="Share screen">
                  <TooltipTrigger
                    render={<Button onClick={startScreen} size="sm" />}
                  >
                    <Share2 />
                    Share Screen
                  </TooltipTrigger>
                </ControlTooltip>
                <ControlTooltip label="Start camera">
                  <TooltipTrigger
                    render={
                      <Button
                        onClick={startCamera}
                        size="sm"
                        variant="outline"
                      />
                    }
                  >
                    <Video />
                    Start Camera
                  </TooltipTrigger>
                </ControlTooltip>
              </>
            )}
          </ToolbarGroup>

          {isCamera && (
            <CameraSelect cameraId={cameraId} setCameraId={setCameraId} />
          )}

          <ToolbarSeparator orientation="vertical" />

          <ControlTooltip label={landmarksLabel}>
            <TooltipTrigger
              render={
                <Button
                  aria-label={landmarksLabel}
                  aria-pressed={drawLandmarks}
                  onClick={toggleLandmarks}
                  size="icon-sm"
                  variant={drawLandmarks ? "secondary" : "ghost"}
                />
              }
            >
              {drawLandmarks ? <Eye /> : <EyeOff />}
            </TooltipTrigger>
          </ControlTooltip>

          <ControlTooltip label={devLabel}>
            <TooltipTrigger
              render={
                <Button
                  aria-label={devLabel}
                  aria-pressed={devEnabled}
                  onClick={toggleDev}
                  size="icon-sm"
                  variant={devEnabled ? "secondary" : "ghost"}
                />
              }
            >
              <Bug />
            </TooltipTrigger>
          </ControlTooltip>

          <ControlTooltip label="Star on GitHub">
            <TooltipTrigger
              render={
                <a
                  aria-label="Star hand-wave on GitHub"
                  className={buttonVariants({
                    size: "icon-sm",
                    variant: "ghost",
                  })}
                  href={repositoryUrl}
                  rel="noreferrer"
                  target="_blank"
                />
              }
            >
              <Star />
            </TooltipTrigger>
          </ControlTooltip>

          <ControlTooltip label={fullLabel}>
            <TooltipTrigger
              render={
                <Button
                  aria-label={fullLabel}
                  onClick={onFull}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              {full ? <Minimize /> : <Maximize />}
            </TooltipTrigger>
          </ControlTooltip>
        </Toolbar>
      </TooltipProvider>
    </div>
  );
});

function ControlTooltip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}): ReactElement {
  return (
    <Tooltip>
      {children}
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
