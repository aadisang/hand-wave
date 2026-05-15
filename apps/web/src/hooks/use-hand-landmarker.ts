import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useEffect, useRef, type RefObject } from "react";

const wasmPath =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const handLandmarkerModelPath =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const poseLandmarkerModelPath =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

type Landmarkers = {
  hand: HandLandmarker;
  pose: PoseLandmarker;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

export type HandLandmarksFrame = {
  rightHandLandmarks: NormalizedLandmark[][];
  leftHandLandmarks: NormalizedLandmark[][];
  poseLandmarks: NormalizedLandmark[][];
};

let landmarkerPromise: Promise<Landmarkers> | null = null;

const loadLandmarkers = async () => {
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  const [hand, pose] = await Promise.all([
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handLandmarkerModelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    }),
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseLandmarkerModelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    }),
  ]);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create MediaPipe input canvas");
  }

  return { hand, pose, canvas, context };
};

function detectFrame(
  landmarkers: Landmarkers,
  video: HTMLVideoElement,
  timestamp: number,
) {
  const input = mirroredVideoFrame(landmarkers, video);
  const hand = landmarkers.hand.detectForVideo(input, timestamp);
  const pose = landmarkers.pose.detectForVideo(input, timestamp);
  const rightHandLandmarks: NormalizedLandmark[][] = [];
  const leftHandLandmarks: NormalizedLandmark[][] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const category = hand.handedness[index]?.[0]?.categoryName;
    if (category === "Left") {
      leftHandLandmarks.push(landmarks);
    } else {
      rightHandLandmarks.push(landmarks);
    }
  });

  return {
    rightHandLandmarks,
    leftHandLandmarks,
    poseLandmarks: pose.landmarks,
  };
}

function mirroredVideoFrame(landmarkers: Landmarkers, video: HTMLVideoElement) {
  const { canvas, context } = landmarkers;
  const { videoWidth, videoHeight } = video;

  if (canvas.width !== videoWidth) canvas.width = videoWidth;
  if (canvas.height !== videoHeight) canvas.height = videoHeight;

  context.save();
  context.setTransform(-1, 0, 0, 1, videoWidth, 0);
  context.drawImage(video, 0, 0, videoWidth, videoHeight);
  context.restore();

  return canvas;
}

export const preloadHandLandmarker = () => {
  landmarkerPromise ??= loadLandmarkers();
  return landmarkerPromise;
};

const getHandLandmarker = preloadHandLandmarker;

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
    let landmarkers: Landmarkers | null = null;

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!landmarkers || !video) return;
      if (video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;

      lastVideoTime = video.currentTime;
      const start = performance.now();
      const frame = detectFrame(landmarkers, video, start);
      onFrameRef.current(frame, performance.now() - start);
    };

    void getHandLandmarker().then((instance) => {
      if (cancelled) return;
      landmarkers = instance;
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, active]);
}
