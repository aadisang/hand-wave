import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { LandmarkFrame } from "@/inference";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";

const handLandmarks = 21;
const poseLandmarks = 33;

export function toInferenceFrame(
  frame: HandLandmarksFrame,
): LandmarkFrame | null {
  const right = frame.rightHandLandmarks[0];
  const left = frame.leftHandLandmarks[0];
  const pose = frame.poseLandmarks[0];
  if (!pose || (!right && !left)) return null;

  const useLeft = !right && Boolean(left);
  const hand = useLeft ? mirrorLandmarks(left ?? []) : (right ?? []);
  const alignedPose = useLeft ? mirrorLandmarks(pose) : pose;
  if (hand.length !== handLandmarks || alignedPose.length !== poseLandmarks) {
    return null;
  }

  return {
    timestamp_ms: Math.round(performance.timeOrigin + performance.now()),
    landmarks: [...hand.map(toPoint), ...alignedPose.map(toPoint)],
  };
}

function mirrorLandmarks(points: NormalizedLandmark[]) {
  return points.map((point) => ({ ...point, x: 1 - point.x }));
}

function toPoint(point: NormalizedLandmark) {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
  };
}
