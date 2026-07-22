import {
  DrawingUtils,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { CaptureKind } from "@/types/capture";
import { useHandLandmarks } from "@/hooks/use-landmarks";
import {
  createActiveHandSelector,
  toModelInput,
} from "@/lib/mediapipe/landmarks";
import { useDevStore } from "@/stores/dev-store";
import type { Frame } from "@/types/inference";
import type { HandFrame } from "@/types/landmarks";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  captureKind: CaptureKind;
  draw: boolean;
  onFrame: (frame: Frame | null) => void;
};

const handPointColor = "rgba(16, 185, 129, 0.95)";
const handLineColor = "rgba(255, 255, 255, 0.85)";
const posePointColor = "rgba(96, 165, 250, 0.85)";
const poseLineColor = "rgba(147, 197, 253, 0.55)";

export function LandmarksOverlay({
  videoRef,
  captureKind,
  draw,
  onFrame: onInferenceFrame,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasDirtyRef = useRef(false);
  const [handSelector] = useState(createActiveHandSelector);

  const onFrame = useCallback(
    (frame: HandFrame, inferenceMs: number) => {
      const selectedHand = handSelector.select(frame);
      const input = toModelInput(frame, selectedHand);
      if (draw && input) {
        drawFrame(canvasRef.current, videoRef.current, input.frame);
        canvasDirtyRef.current = true;
      } else if (canvasDirtyRef.current) {
        clearCanvas(canvasRef.current);
        canvasDirtyRef.current = false;
      }

      onInferenceFrame(input?.features ?? null);
      const dev = useDevStore.getState();
      if (dev.enabled) {
        dev.push(input?.frame ?? null, inferenceMs);
        if (dev.recording) {
          dev.pushFrameTrace({
            inferenceMs,
            captureKind,
            selectedHand,
            rawFrame: frame,
            modelFrame: input?.frame ?? null,
            features: input?.features ?? null,
          });
        }
      }
    },
    [captureKind, draw, handSelector, onInferenceFrame, videoRef],
  );

  useHandLandmarks(videoRef, captureKind, onFrame);

  useEffect(() => {
    const canvas = canvasRef.current;
    return () => clearCanvas(canvas);
  }, []);

  useEffect(() => {
    handSelector.reset();
  }, [captureKind, handSelector]);

  useEffect(() => {
    if (!draw && canvasDirtyRef.current) {
      clearCanvas(canvasRef.current);
      canvasDirtyRef.current = false;
    }
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={[
        "pointer-events-none absolute inset-0 z-10 h-full w-full",
        captureKind === "camera" ? "object-cover" : "object-contain",
      ].join(" ")}
    />
  );
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

function drawFrame(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  frame: HandFrame,
) {
  if (!canvas || !video) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return;

  if (canvas.width !== videoWidth) canvas.width = videoWidth;
  if (canvas.height !== videoHeight) canvas.height = videoHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const drawing = new DrawingUtils(ctx);
  const lineWidth = Math.max(2, canvas.width / 320);
  const radius = Math.max(3, canvas.width / 240);

  const pose = frame.poseLandmarks[0];
  if (pose) {
    drawing.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS, {
      color: poseLineColor,
      lineWidth,
    });
    drawing.drawLandmarks(pose, {
      color: posePointColor,
      radius: radius * 0.75,
    });
  }

  drawHands(drawing, frame.rightHandLandmarks, lineWidth, radius);
  drawHands(drawing, frame.leftHandLandmarks, lineWidth, radius);
}

function drawHands(
  drawing: DrawingUtils,
  hands: HandFrame["rightHandLandmarks"],
  lineWidth: number,
  radius: number,
) {
  for (const hand of hands) {
    drawing.drawConnectors(hand, HandLandmarker.HAND_CONNECTIONS, {
      color: handLineColor,
      lineWidth,
    });
    drawing.drawLandmarks(hand, {
      color: handPointColor,
      radius,
    });
  }
}
