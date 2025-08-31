"use client";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { useSharingStore } from "@/stores/sharing-store";
import { useEffect, useRef } from "react";
import Webcam from "react-webcam";

interface CameraProps {
  onStreamStop: () => void;
}

export function Camera({ onStreamStop }: CameraProps) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stopSharing } = useSharingStore();
  const { ready, start, stop } = useHandLandmarker();

  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user",
  };

  useEffect(() => {
    const videoEl = webcamRef.current?.video as HTMLVideoElement | undefined;
    const canvasEl = canvasRef.current ?? undefined;
    if (!ready || !videoEl || !canvasEl) return;

    // Size canvas to container via CSS; drawing code will handle DPR and letterboxing
    const resize = () => {
      if (!canvasEl?.parentElement) return;
      const { clientWidth, clientHeight } = canvasEl.parentElement;
      canvasEl.style.width = `${clientWidth}px`;
      canvasEl.style.height = `${clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvasEl.parentElement) ro.observe(canvasEl.parentElement);

    start({ video: videoEl, canvas: canvasEl, mirror: true });

    return () => {
      ro.disconnect();
      stop();
    };
  }, [ready, start, stop]);

  return (
    <div className="w-full h-full relative">
      <Webcam
        ref={webcamRef}
        audio={false}
        videoConstraints={videoConstraints}
        className="w-full h-full object-contain"
        mirrored={true}
        onUserMediaError={() => {
          stopSharing();
          onStreamStop();
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
      />
    </div>
  );
}

