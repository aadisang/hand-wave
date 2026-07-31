import { expose } from "comlink";
import {
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { DetectionRequest, PoseDetectorApi } from "@/types/landmarks";
import { poseModelUrl } from "./assets";
import { filterConsole } from "./console";
import { createRecentPose } from "./recent-pose";
import { loadWorkerVisionFileset } from "./runtime";
import { createSmoother } from "./smooth";

const landmarkConfidence = 0.5;
const poseReuseMs = 500;

const smoother = createSmoother("pose");
const recentPose = createRecentPose(poseReuseMs);
const tracker = load();

async function load() {
  filterConsole();
  return PoseLandmarker.createFromOptions(await loadWorkerVisionFileset(), {
    baseOptions: { modelAssetPath: poseModelUrl, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: landmarkConfidence,
    minPosePresenceConfidence: landmarkConfidence,
    minTrackingConfidence: landmarkConfidence,
  });
}

function cloneLandmarkSets(sets: NormalizedLandmark[][]) {
  return sets.map((landmarks) =>
    landmarks.map((landmark) => ({ ...landmark })),
  );
}

const api: PoseDetectorApi = {
  async warm() {
    await tracker;
  },
  async detect(request: DetectionRequest) {
    const start = performance.now();
    try {
      const instance = await tracker;
      const detected = cloneLandmarkSets(
        instance.detectForVideo(request.image, request.timestamp).landmarks,
      );
      const poseLandmarks = recentPose.update(detected, request.timestamp);
      return {
        poseLandmarks: smoother.smooth(poseLandmarks, request.timestamp),
        inferenceMs: performance.now() - start,
      };
    } finally {
      request.image.close();
    }
  },
  reset() {
    recentPose.reset();
    smoother.reset();
  },
};

expose(api);
