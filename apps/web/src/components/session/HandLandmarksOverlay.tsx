import { HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  useHandLandmarks,
  type HandLandmarksFrame,
} from "@/hooks/use-hand-landmarker";
import { useDevStore } from "@/stores/dev-store";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
};

const connections = HandLandmarker.HAND_CONNECTIONS;
const pointColor = "rgba(16, 185, 129, 0.95)";
const lineColor = "rgba(255, 255, 255, 0.85)";

export function HandLandmarksOverlay({ videoRef, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameRef = useRef<HandLandmarksFrame | null>(null);

  const onFrame = useCallback(
    (frame: HandLandmarksFrame, inferenceMs: number) => {
      lastFrameRef.current = frame;
      drawFrame(canvasRef.current, videoRef.current, frame);
      const dev = useDevStore.getState();
      if (dev.enabled) dev.push(frame, inferenceMs);
    },
    [videoRef],
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
      className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover -scale-x-100"
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

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = pointColor;

  for (const hand of frame.landmarks) {
    ctx.beginPath();
    for (const { start, end } of connections) {
      const a = hand[start];
      const b = hand[end];
      if (!a || !b) continue;
      ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    }
    ctx.stroke();

    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}
