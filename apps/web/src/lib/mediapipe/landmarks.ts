import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { LandmarkFrame } from "@/types/inference";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";

const handLandmarks = 21;
const poseLandmarks = 33;
const requiredPoseLandmarks = [0, 11, 12];
const lowerBound = -0.15;
const upperBound = 1.15;

export function toInferenceFrame(
  frame: HandLandmarksFrame,
): LandmarkFrame | null {
  const right = frame.rightHandLandmarks[0];
  const left = frame.leftHandLandmarks[0];
  const pose = frame.poseLandmarks[0];
  if (!pose) return null;

  if (right) return packLandmarks(right, pose);
  if (left) return packLandmarks(mirrorLandmarks(left), mirrorLandmarks(pose));
  return null;
}

function packLandmarks(
  hand: NormalizedLandmark[],
  alignedPose: NormalizedLandmark[],
) {
  if (
    hand.length !== handLandmarks ||
    alignedPose.length !== poseLandmarks ||
    !hasUsableCoordinates(hand) ||
    !hasUsablePose(alignedPose)
  ) {
    return null;
  }

  const features: number[] = [];
  pushPoints(features, hand);
  pushPoints(features, alignedPose);
  return features;
}

function mirrorLandmarks(points: NormalizedLandmark[]) {
  return points.map((point) => ({ ...point, x: 1 - point.x }));
}

function hasUsableCoordinates(points: NormalizedLandmark[]) {
  return points.every(isFinitePoint);
}

function hasUsablePose(points: NormalizedLandmark[]) {
  return requiredPoseLandmarks.every(
    (index) => isFinitePoint(points[index]) && isInFrame(points[index]),
  );
}

function isFinitePoint(point: NormalizedLandmark | undefined) {
  return (
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z ?? 0)
  );
}

function isInFrame(point: NormalizedLandmark | undefined) {
  return (
    point !== undefined &&
    point.x >= lowerBound &&
    point.x <= upperBound &&
    point.y >= lowerBound &&
    point.y <= upperBound
  );
}

function pushPoints(features: number[], points: NormalizedLandmark[]) {
  for (const point of points) {
    features.push(point.x, point.y, point.z ?? 0);
  }
}
