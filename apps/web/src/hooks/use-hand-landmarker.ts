import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, type RefObject } from "react";

const wasmPath =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const handLandmarkerModelPath =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

const loadHandLandmarker = async () => {
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: handLandmarkerModelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.7,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
};

export const preloadHandLandmarker = () => {
  landmarkerPromise ??= loadHandLandmarker();
  return landmarkerPromise;
};

const getHandLandmarker = preloadHandLandmarker;

export type HandLandmarksFrame = HandLandmarkerResult;

type Listener = (frame: HandLandmarksFrame, inferenceMs: number) => void;

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  onFrame: Listener,
): void {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;
    let landmarker: HandLandmarker | null = null;

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!landmarker || !video) return;
      if (video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;

      lastVideoTime = video.currentTime;
      const start = performance.now();
      const frame = landmarker.detectForVideo(video, start);
      onFrameRef.current(frame, performance.now() - start);
    };

    void getHandLandmarker().then((instance) => {
      if (cancelled) return;
      landmarker = instance;
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, active]);
}
