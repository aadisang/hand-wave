"use client";
import { useRef } from "react";

function ScreenShare() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const startSharing = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error: " + err);
    }
  };

  return (
    <div>
      <button onClick={startSharing}>Share a tab or screen</button>
      <video ref={videoRef} autoPlay playsInline style={{ width: "100%" }} />
    </div>
  );
}

export default ScreenShare;

