import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useCallbackRef } from "@mantine/hooks";
import { useEffect, type RefObject } from "react";
import { createLandmarkSmoother } from "@/lib/mediapipe/landmark-smoother";

const wasmPath =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const handLandmarkerModelPath =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const poseLandmarkerModelPath =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const landmarkConfidence = 0.5;

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
      minHandDetectionConfidence: landmarkConfidence,
      minHandPresenceConfidence: landmarkConfidence,
      minTrackingConfidence: landmarkConfidence,
    }),
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseLandmarkerModelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: landmarkConfidence,
      minPosePresenceConfidence: landmarkConfidence,
      minTrackingConfidence: landmarkConfidence,
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
  mirrored: boolean,
) {
  const input = mirrored ? mirroredVideoFrame(landmarkers, video) : video;
  const hand = landmarkers.hand.detectForVideo(input, timestamp);
  const pose = landmarkers.pose.detectForVideo(input, timestamp);
  const rightHandLandmarks: NormalizedLandmark[][] = [];
  const leftHandLandmarks: NormalizedLandmark[][] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const category = anatomicalHand(
      hand.handedness[index]?.[0]?.categoryName,
      mirrored,
    );
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

function anatomicalHand(category: string | undefined, mirrored: boolean) {
  if (!mirrored) return category === "Left" ? "Left" : "Right";
  if (category === "Left") return "Right";
  if (category === "Right") return "Left";
  return "Right";
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
  mirrored: boolean,
  onFrame: Listener,
): void {
  const onFrameRef = useCallbackRef(onFrame);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;
    let landmarkers: Landmarkers | null = null;
    const smoother = createLandmarkSmoother();

    const tick = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!landmarkers || !video) return;
      if (video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;

      lastVideoTime = video.currentTime;
      const start = performance.now();
      const frame = smoother.smooth(
        detectFrame(landmarkers, video, start, mirrored),
        start,
      );
      onFrameRef(frame, performance.now() - start);
    };

    void getHandLandmarker().then((instance) => {
      if (cancelled) return;
      landmarkers = instance;
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      smoother.reset();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, active, mirrored, onFrameRef]);
}
