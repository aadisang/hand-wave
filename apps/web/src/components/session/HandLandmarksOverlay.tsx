import {
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  useHandLandmarks,
  type HandLandmarksFrame,
} from "@/hooks/use-hand-landmarker";
import { useDevStore } from "@/stores/dev-store";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  onFrame?: (frame: HandLandmarksFrame) => void;
};

type LandmarkConnection = { start: number; end: number };

const handConnections = HandLandmarker.HAND_CONNECTIONS as LandmarkConnection[];
const poseConnections = PoseLandmarker.POSE_CONNECTIONS as LandmarkConnection[];
const handPointColor = "rgba(16, 185, 129, 0.95)";
const handLineColor = "rgba(255, 255, 255, 0.85)";
const posePointColor = "rgba(96, 165, 250, 0.85)";
const poseLineColor = "rgba(147, 197, 253, 0.55)";

export function HandLandmarksOverlay({ videoRef, active, onFrame: onInferenceFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameRef = useRef<HandLandmarksFrame | null>(null);

  const onFrame = useCallback(
    (frame: HandLandmarksFrame, inferenceMs: number) => {
      lastFrameRef.current = frame;
      drawFrame(canvasRef.current, videoRef.current, frame);
      onInferenceFrame?.(frame);
      const dev = useDevStore.getState();
      if (dev.enabled) dev.push(frame, inferenceMs);
    },
    [onInferenceFrame, videoRef],
  );

  useHandLandmarks(videoRef, active, onFrame);

  useEffect(() => {
    if (!active) {
      lastFrameRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
    />
  );
}

function drawFrame(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  frame: HandLandmarksFrame,
) {
  if (!canvas || !video) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return;

  if (canvas.width !== videoWidth) canvas.width = videoWidth;
  if (canvas.height !== videoHeight) canvas.height = videoHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const lineWidth = Math.max(2, canvas.width / 320);
  const radius = Math.max(3, canvas.width / 240);

  const pose = frame.poseLandmarks[0];
  if (pose) {
    drawLandmarkSet(ctx, pose, poseConnections, {
      width: canvas.width,
      height: canvas.height,
      lineWidth,
      radius: radius * 0.75,
      strokeStyle: poseLineColor,
      fillStyle: posePointColor,
    });
  }

  for (const hand of [...frame.rightHandLandmarks, ...frame.leftHandLandmarks]) {
    drawLandmarkSet(ctx, hand, handConnections, {
      width: canvas.width,
      height: canvas.height,
      lineWidth,
      radius,
      strokeStyle: handLineColor,
      fillStyle: handPointColor,
    });
  }
}

function drawLandmarkSet(
  ctx: CanvasRenderingContext2D,
  points: NormalizedLandmark[],
  connections: LandmarkConnection[],
  style: {
    width: number;
    height: number;
    lineWidth: number;
    radius: number;
    strokeStyle: string;
    fillStyle: string;
  },
) {
  ctx.lineWidth = style.lineWidth;
  ctx.strokeStyle = style.strokeStyle;
  ctx.fillStyle = style.fillStyle;

  ctx.beginPath();
  for (const { start, end } of connections) {
    const a = points[start];
    const b = points[end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * style.width, a.y * style.height);
    ctx.lineTo(b.x * style.width, b.y * style.height);
  }
  ctx.stroke();

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(
      point.x * style.width,
      point.y * style.height,
      style.radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
