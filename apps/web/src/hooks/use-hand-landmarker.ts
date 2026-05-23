import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useCallbackRef } from "@mantine/hooks";
import { useEffect, type RefObject } from "react";
import type { CaptureKind } from "@/hooks/use-capture-session";
import { installMediapipeConsoleFilter } from "@/lib/mediapipe/console-filter";
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

type Handedness = "Left" | "Right";

export type HandLandmarksFrame = {
  rightHandLandmarks: NormalizedLandmark[][];
  leftHandLandmarks: NormalizedLandmark[][];
  poseLandmarks: NormalizedLandmark[][];
};

let landmarkerPromise: Promise<Landmarkers> | null = null;
let lastLandmarkerTimestampMs = 0;

const loadLandmarkers = async () => {
  installMediapipeConsoleFilter();
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
  captureKind: CaptureKind,
) {
  const input =
    captureKind === "camera" ? selfieInputFrame(landmarkers, video) : video;
  const hand = landmarkers.hand.detectForVideo(input, timestamp);
  const pose = landmarkers.pose.detectForVideo(input, timestamp);
  const rightHandLandmarks: NormalizedLandmark[][] = [];
  const leftHandLandmarks: NormalizedLandmark[][] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const category = anatomicalHand(
      hand.handedness[index][0].categoryName as Handedness,
      captureKind,
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

function anatomicalHand(category: Handedness, captureKind: CaptureKind) {
  if (captureKind === "screen") return category;
  if (category === "Left") return "Right";
  return "Left";
}

function selfieInputFrame(landmarkers: Landmarkers, video: HTMLVideoElement) {
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

function nextLandmarkerTimestamp() {
  lastLandmarkerTimestampMs = Math.max(
    performance.now(),
    lastLandmarkerTimestampMs + 1,
  );
  return lastLandmarkerTimestampMs;
}

function resetLandmarkers(instance: Landmarkers | null) {
  instance?.hand.close();
  instance?.pose.close();
  landmarkerPromise = null;
}

type Listener = (frame: HandLandmarksFrame, inferenceMs: number) => void;

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  captureKind: CaptureKind,
  onFrame: Listener,
): void {
  const onFrameRef = useCallbackRef(onFrame);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let videoFrameId = 0;
    let frameCallbackVideo: HTMLVideoElement | null = null;
    let landmarkers: Landmarkers | null = null;
    let loading = false;
    const smoother = createLandmarkSmoother();

    const load = () => {
      if (loading || cancelled) return;
      loading = true;
      void preloadHandLandmarker()
        .then((instance) => {
          if (cancelled) return;
          landmarkers = instance;
          rafId = requestAnimationFrame(waitForVideo);
        })
        .finally(() => {
          loading = false;
        });
    };

    const detect = (
      instance: Landmarkers,
      video: HTMLVideoElement,
      timestamp: number,
    ) => {
      const start = performance.now();
      try {
        const frame = smoother.smooth(
          detectFrame(instance, video, timestamp, captureKind),
          timestamp,
        );
        onFrameRef(frame, performance.now() - start);
      } catch {
        resetLandmarkers(instance);
        landmarkers = null;
        smoother.reset();
        load();
      }
    };

    const tickVideoFrame: VideoFrameRequestCallback = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!video) return;
      if (landmarkers && video.readyState >= 2) {
        detect(landmarkers, video, nextLandmarkerTimestamp());
      }
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    const waitForVideo = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!landmarkers || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(waitForVideo);
        return;
      }

      frameCallbackVideo = video;
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    load();

    return () => {
      cancelled = true;
      smoother.reset();
      if (rafId) cancelAnimationFrame(rafId);
      if (videoFrameId && frameCallbackVideo) {
        frameCallbackVideo.cancelVideoFrameCallback(videoFrameId);
      }
    };
  }, [videoRef, captureKind, onFrameRef]);
}
