import {
  CircleStop,
  Maximize,
  MessageCircle,
  Minimize,
  Share2,
  Video,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import type { CaptureSession } from "@/hooks/use-capture-session";
import type { FullscreenControls } from "@/hooks/use-fullscreen";
import { useDetectionsStore } from "@/stores/detections-store";
import { CameraSelect } from "./CameraSelect";

type Props = {
  capture: CaptureSession;
  fullscreen: FullscreenControls;
};

export function StreamToolbar({ capture, fullscreen }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const prediction = useDetectionsStore((s) => s.currentPrediction);
  const { state } = capture;
  const isCapturing = state.status === "live" || state.status === "starting";
  const isCamera = isCapturing && state.kind === "camera";

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      const w = content.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="absolute right-0 bottom-4 left-0 z-20 flex justify-center px-3 sm:bottom-5">
      <div
        className="flex h-control-center justify-center overflow-hidden"
        style={{
          width: width != null ? `${width}px` : "auto",
          transition: reduceMotion
            ? "none"
            : "width 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div ref={contentRef} className="h-control-center w-max shrink-0">
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

            {isCapturing && prediction && (
              <Button onClick={() => undefined} size="sm" variant="secondary">
                <MessageCircle />
                Send
              </Button>
            )}

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
      </div>
    </div>
  );
}
