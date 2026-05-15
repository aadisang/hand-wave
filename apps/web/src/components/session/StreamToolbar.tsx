import {
  Bug,
  CircleStop,
  Maximize,
  MessageCircle,
  Radio,
  Minimize,
  Share2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import type { CaptureSession } from "@/hooks/use-capture-session";
import type { FullscreenControls } from "@/hooks/use-fullscreen";
import { useDetectionsStore } from "@/stores/detections-store";
import { useDevStore } from "@/stores/dev-store";
import { CameraSelect } from "./CameraSelect";

type Props = {
  capture: CaptureSession;
  clip: {
    bufferedFrames: number;
    isDecoding: boolean;
    isRecording: boolean;
    startRecording: () => void;
    stopRecording: () => void;
    stopAndDecode: () => void;
    decode: () => void;
  };
  fullscreen: FullscreenControls;
};

export function StreamToolbar({ capture, clip, fullscreen }: Props) {
  const hasPrediction = useDetectionsStore((s) => s.currentPrediction != null);
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

        {isCamera && (
          <ToolbarGroup>
            {clip.isRecording ? (
              <Button
                onClick={clip.stopAndDecode}
                size="sm"
                variant="destructive"
              >
                <CircleStop />
                Stop & Decode
              </Button>
            ) : (
              <Button
                onClick={clip.startRecording}
                size="sm"
                variant="secondary"
              >
                <Radio />
                Record
              </Button>
            )}
            {!clip.isRecording && clip.bufferedFrames > 0 && (
              <Button
                disabled={clip.isDecoding}
                onClick={clip.decode}
                size="sm"
                variant="outline"
              >
                <MessageCircle />
                Decode
              </Button>
            )}
          </ToolbarGroup>
        )}

        <ToolbarSeparator orientation="vertical" />

        {isCapturing && hasPrediction && (
          <Button onClick={() => undefined} size="sm" variant="secondary">
            <MessageCircle />
            Send
          </Button>
        )}

        <Button
          aria-label={devEnabled ? "Hide dev panel" : "Show dev panel"}
          aria-pressed={devEnabled}
          onClick={toggleDev}
          size="icon-sm"
          variant={devEnabled ? "secondary" : "ghost"}
        >
          <Bug />
        </Button>

        <Button
          aria-label={
            fullscreen.isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
          }
          onClick={fullscreen.toggle}
          size="icon-sm"
          variant="ghost"
        >
          {fullscreen.isFullscreen ? <Minimize /> : <Maximize />}
        </Button>
      </Toolbar>
    </div>
  );
}
