"use client";
import { useSharingStore } from "@/stores/sharing-store";
import { useRef } from "react";
import Webcam from "react-webcam";

interface CameraProps {
  onStreamStop: () => void;
}

export function Camera({ onStreamStop }: CameraProps) {
  const webcamRef = useRef<Webcam>(null);
  const { stopSharing } = useSharingStore();

  const videoConstraints = {
    width: 1280,
    height: 720,
    facingMode: "user",
  };

  return (
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
  );
}

