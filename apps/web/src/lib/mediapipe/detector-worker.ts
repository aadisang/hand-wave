import { expose } from "comlink";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { CaptureKind } from "@/types/capture";
import type {
  HandFrame,
  HandSide,
  LandmarkDetectionRequest,
  LandmarkDetectorApi,
} from "@/types/landmarks";
import { handModelUrl, poseModelUrl, wasmPath } from "./assets";
import { filterConsole } from "./console";
import { createSmoother } from "./smooth";

const landmarkConfidence = 0.5;
const maxDetectorDimension = 640;
const poseSampleMs = 1000 / 12;
const poseReuseMs = 500;

type Trackers = {
  hand: HandLandmarker;
  pose: PoseLandmarker;
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
};

type DetectionState = {
  poseLandmarks: HandFrame["poseLandmarks"];
  poseAt: number;
};

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const smoother = createSmoother();
const state: DetectionState = { poseLandmarks: [], poseAt: 0 };
const trackers = load();

async function load() {
  filterConsole();
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  const hand = await createHand(fileset);
  const pose = await createPose(fileset);
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create MediaPipe worker input canvas");
  }

  return { hand, pose, canvas, context };
}

async function createHand(fileset: WasmFileset) {
  await installModuleFactory(fileset.wasmLoaderPath);
  return HandLandmarker.createFromOptions(withInstalledLoader(fileset), {
    baseOptions: { modelAssetPath: handModelUrl, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: landmarkConfidence,
    minHandPresenceConfidence: landmarkConfidence,
    minTrackingConfidence: landmarkConfidence,
  });
}

async function createPose(fileset: WasmFileset) {
  await installModuleFactory(fileset.wasmLoaderPath);
  return PoseLandmarker.createFromOptions(withInstalledLoader(fileset), {
    baseOptions: { modelAssetPath: poseModelUrl, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: landmarkConfidence,
    minPosePresenceConfidence: landmarkConfidence,
    minTrackingConfidence: landmarkConfidence,
  });
}

async function installModuleFactory(loaderPath: string) {
  const source = await loadScript(loaderPath);
  // MediaPipe's task runner expects this factory on the worker global. Vite
  // module workers do not get that from MediaPipe's internal script helper.
  (0, eval)(`${source}\n;globalThis.ModuleFactory = ModuleFactory;`);
  if (!("ModuleFactory" in globalThis)) {
    throw new Error("MediaPipe WASM module factory did not install");
  }
}

function loadScript(url: string) {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(
        `Could not load MediaPipe WASM loader: ${response.status}`,
      );
    }
    return response.text();
  });
}

function withInstalledLoader(fileset: WasmFileset): WasmFileset {
  return { ...fileset, wasmLoaderPath: "" };
}

function detect(
  instance: Trackers,
  image: ImageBitmap,
  timestamp: number,
  captureKind: CaptureKind,
) {
  const input = detectorInput(instance, image, captureKind);
  const hand = instance.hand.detectForVideo(input, timestamp);
  const shouldSamplePose =
    state.poseLandmarks.length === 0 ||
    timestamp - state.poseAt >= poseSampleMs;

  if (shouldSamplePose) {
    state.poseLandmarks = cloneLandmarkSets(
      instance.pose.detectForVideo(input, timestamp).landmarks,
    );
    state.poseAt = timestamp;
  } else if (timestamp - state.poseAt > poseReuseMs) {
    state.poseLandmarks = [];
  }

  const rightHandLandmarks: HandFrame["rightHandLandmarks"] = [];
  const leftHandLandmarks: HandFrame["leftHandLandmarks"] = [];

  hand.landmarks.forEach((landmarks, index) => {
    const category = anatomicalHand(
      hand.handedness[index][0].categoryName as HandSide,
      captureKind,
    );
    if (category === "Left") {
      leftHandLandmarks.push(cloneLandmarkSet(landmarks));
    } else {
      rightHandLandmarks.push(cloneLandmarkSet(landmarks));
    }
  });

  return {
    rightHandLandmarks,
    leftHandLandmarks,
    poseLandmarks: state.poseLandmarks,
  };
}

function anatomicalHand(category: HandSide, captureKind: CaptureKind) {
  if (captureKind === "screen") return category;
  if (category === "Left") return "Right";
  return "Left";
}

function detectorInput(
  instance: Trackers,
  image: ImageBitmap,
  captureKind: CaptureKind,
) {
  const { canvas, context } = instance;
  const largest = Math.max(image.width, image.height);
  const scale =
    largest > maxDetectorDimension ? maxDetectorDimension / largest : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  if (captureKind === "camera") {
    context.setTransform(-1, 0, 0, 1, width, 0);
  } else {
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
  context.drawImage(image, 0, 0, width, height);
  context.setTransform(1, 0, 0, 1, 0, 0);

  return canvas;
}

function cloneLandmarkSets(sets: NormalizedLandmark[][]) {
  return sets.map(cloneLandmarkSet);
}

function cloneLandmarkSet(landmarks: NormalizedLandmark[]) {
  return landmarks.map((landmark) => ({ ...landmark }));
}

const api: LandmarkDetectorApi = {
  async warm() {
    await trackers;
  },
  async detect(request: LandmarkDetectionRequest) {
    const start = performance.now();
    try {
      const instance = await trackers;
      const frame = smoother.smooth(
        detect(instance, request.image, request.timestamp, request.captureKind),
        request.timestamp,
      );
      return { frame, inferenceMs: performance.now() - start };
    } finally {
      request.image.close();
    }
  },
};

expose(api);
