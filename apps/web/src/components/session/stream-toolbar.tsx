import {
  Bug,
  CircleStop,
  Maximize,
  Minimize,
  Share2,
  Star,
  Video,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import type { CaptureSession } from "@/types/capture";
import { useDevStore } from "@/stores/dev-store";
import { CameraSelect } from "./camera-select";

const repositoryUrl = "https://github.com/sinarck/hand-wave";

type Props = {
  capture: CaptureSession;
  full: boolean;
  onFull: () => void;
};

export function StreamToolbar({ capture, full, onFull }: Props) {
  const devEnabled = useDevStore((s) => s.enabled);
  const toggleDev = useDevStore((s) => s.toggle);
  const { state } = capture;
  const isCapturing = state.status === "live" || state.status === "starting";
  const isCamera = isCapturing && state.kind === "camera";

  return (
    <div className="absolute right-0 bottom-4 left-0 z-20 flex justify-center px-3 sm:bottom-5">
      <Toolbar
        aria-label="Stream controls"
        className="h-control-center items-center gap-1 bg-toolbar px-1.5 py-1 backdrop-blur-md"
      >
        <ToolbarGroup>
          {isCapturing ? (
            <Button
              aria-label="Stop sharing"
              onClick={capture.stop}
              size="icon-sm"
              variant="destructive"
            >
              <CircleStop />
            </Button>
          ) : (
            <>
              <Button onClick={() => capture.start("screen")} size="sm">
                <Share2 />
                Share Screen
              </Button>
              <Button
                onClick={() => capture.start("camera")}
                size="sm"
                variant="outline"
              >
                <Video />
                Start Camera
              </Button>
            </>
          )}
        </ToolbarGroup>

        {isCamera && <CameraSelect capture={capture} />}

        <ToolbarSeparator orientation="vertical" />

        <Button
          aria-label={devEnabled ? "Hide dev panel" : "Show dev panel"}
          aria-pressed={devEnabled}
          onClick={toggleDev}
          size="icon-sm"
          variant={devEnabled ? "secondary" : "ghost"}
        >
          <Bug />
        </Button>

        <a
          aria-label="Star hand-wave on GitHub"
          className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
          href={repositoryUrl}
          rel="noreferrer"
          target="_blank"
          title="Star on GitHub"
        >
          <Star />
        </a>

        <Button
          aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={onFull}
          size="icon-sm"
          variant="ghost"
        >
          {full ? <Minimize /> : <Maximize />}
        </Button>
      </Toolbar>
    </div>
  );
}
