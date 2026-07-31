import { expose } from "comlink";
import {
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type {
  HandFrame,
  HandDetectorApi,
  HandSide,
  DetectionRequest,
} from "@/types/landmarks";
import { handModelUrl } from "./assets";
import { filterConsole } from "./console";
import { handednessForUnmirroredInput } from "./landmarks";
import { loadWorkerVisionFileset } from "./runtime";
import { createSmoother } from "./smooth";

const landmarkConfidence = 0.5;

const rightHandSmoother = createSmoother("hand");
const leftHandSmoother = createSmoother("hand");
const tracker = load();

async function load() {
  filterConsole();
  return HandLandmarker.createFromOptions(await loadWorkerVisionFileset(), {
    baseOptions: { modelAssetPath: handModelUrl, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: landmarkConfidence,
    minHandPresenceConfidence: landmarkConfidence,
    minTrackingConfidence: landmarkConfidence,
  });
}

function detect(
  instance: HandLandmarker,
  image: ImageBitmap,
  timestamp: number,
) {
  const hand = instance.detectForVideo(image, timestamp);
  const rightHandLandmarks: HandFrame["rightHandLandmarks"] = [];
  const leftHandLandmarks: HandFrame["leftHandLandmarks"] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const detectedSide = parseHandSide(
      hand.handedness[index]?.[0]?.categoryName,
    );
    if (!detectedSide) return;
    const category = handednessForUnmirroredInput(detectedSide);
    if (category === "Left") {
      leftHandLandmarks.push(cloneLandmarkSet(landmarks));
    } else {
      rightHandLandmarks.push(cloneLandmarkSet(landmarks));
    }
  });

  return { rightHandLandmarks, leftHandLandmarks };
}

function parseHandSide(value: string | undefined): HandSide | null {
  return value === "Left" || value === "Right" ? value : null;
}

function cloneLandmarkSet(landmarks: NormalizedLandmark[]) {
  return landmarks.map((landmark) => ({ ...landmark }));
}

const api: HandDetectorApi = {
  async warm() {
    await tracker;
  },
  async detect(request: DetectionRequest) {
    const start = performance.now();
    try {
      const instance = await tracker;
      const frame = detect(instance, request.image, request.timestamp);
      return {
        frame: {
          rightHandLandmarks: rightHandSmoother.smooth(
            frame.rightHandLandmarks,
            request.timestamp,
          ),
          leftHandLandmarks: leftHandSmoother.smooth(
            frame.leftHandLandmarks,
            request.timestamp,
          ),
        },
        inferenceMs: performance.now() - start,
      };
    } finally {
      request.image.close();
    }
  },
  reset() {
    rightHandSmoother.reset();
    leftHandSmoother.reset();
  },
};

expose(api);
