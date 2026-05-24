import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import { useEvent } from "@reactuses/core";
import { useEffect, type RefObject } from "react";
import type { CaptureKind } from "@/types/capture";
import { filterConsole } from "@/lib/mediapipe/console";
import { createSmoother } from "@/lib/mediapipe/smooth";
import type { FrameSink, HandFrame, HandSide, Trackers } from "@/types/landmarks";

const wasmPath =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const handModelUrl =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const poseModelUrl =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const landmarkConfidence = 0.5;

let ready: Promise<Trackers> | null = null;
let lastTs = 0;

const load = async () => {
  filterConsole();
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  const [hand, pose] = await Promise.all([
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handModelUrl, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: landmarkConfidence,
      minHandPresenceConfidence: landmarkConfidence,
      minTrackingConfidence: landmarkConfidence,
    }),
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseModelUrl, delegate: "GPU" },
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

function detect(
  trackers: Trackers,
  video: HTMLVideoElement,
  timestamp: number,
  captureKind: CaptureKind,
) {
  const input =
    captureKind === "camera" ? selfie(trackers, video) : video;
  const hand = trackers.hand.detectForVideo(input, timestamp);
  const pose = trackers.pose.detectForVideo(input, timestamp);
  const rightHandLandmarks: HandFrame["rightHandLandmarks"] = [];
  const leftHandLandmarks: HandFrame["leftHandLandmarks"] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const category = anatomicalHand(
      hand.handedness[index][0].categoryName as HandSide,
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

function anatomicalHand(category: HandSide, captureKind: CaptureKind) {
  if (captureKind === "screen") return category;
  if (category === "Left") return "Right";
  return "Left";
}

function selfie(trackers: Trackers, video: HTMLVideoElement) {
  const { canvas, context } = trackers;
  const { videoWidth, videoHeight } = video;

  if (canvas.width !== videoWidth) canvas.width = videoWidth;
  if (canvas.height !== videoHeight) canvas.height = videoHeight;

  context.save();
  context.setTransform(-1, 0, 0, 1, videoWidth, 0);
  context.drawImage(video, 0, 0, videoWidth, videoHeight);
  context.restore();

  return canvas;
}

export const preloadLandmarker = () => {
  ready ??= load();
  return ready;
};

function nextTs() {
  lastTs = Math.max(performance.now(), lastTs + 1);
  return lastTs;
}

function reset(instance: Trackers | null) {
  instance?.hand.close();
  instance?.pose.close();
  ready = null;
}

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  captureKind: CaptureKind,
  onFrame: FrameSink,
): void {
  const emitFrame = useEvent(onFrame);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let videoFrameId = 0;
    let frameCallbackVideo: HTMLVideoElement | null = null;
    let trackers: Trackers | null = null;
    let loading = false;
    const smoother = createSmoother();

    const ensureLoaded = () => {
      if (loading || cancelled) return;
      loading = true;
      void preloadLandmarker()
        .then((instance) => {
          if (cancelled) return;
          trackers = instance;
          rafId = requestAnimationFrame(waitForVideo);
        })
        .finally(() => {
          loading = false;
        });
    };

    const read = (
      instance: Trackers,
      video: HTMLVideoElement,
      timestamp: number,
    ) => {
      const start = performance.now();
      try {
        const frame = smoother.smooth(
          detect(instance, video, timestamp, captureKind),
          timestamp,
        );
        emitFrame(frame, performance.now() - start);
      } catch {
        reset(instance);
        trackers = null;
        smoother.reset();
        ensureLoaded();
      }
    };

    const tickVideoFrame: VideoFrameRequestCallback = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!video) return;
      if (trackers && video.readyState >= 2) {
        read(trackers, video, nextTs());
      }
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    const waitForVideo = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!trackers || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(waitForVideo);
        return;
      }

      frameCallbackVideo = video;
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    ensureLoaded();

    return () => {
      cancelled = true;
      smoother.reset();
      if (rafId) cancelAnimationFrame(rafId);
      if (videoFrameId && frameCallbackVideo) {
        frameCallbackVideo.cancelVideoFrameCallback(videoFrameId);
      }
    };
  }, [videoRef, captureKind, emitFrame]);
}
