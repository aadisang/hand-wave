import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Frame } from "@/types/inference";
import type { HandFrame } from "@/types/landmarks";

const handCount = 21;
const poseCount = 33;
const requiredPose = [0, 11, 12];
const min = -0.15;
const max = 1.15;

export function toFrame(frame: HandFrame): Frame | null {
  const right = frame.rightHandLandmarks[0];
  const left = frame.leftHandLandmarks[0];
  const pose = frame.poseLandmarks[0];
  if (!pose) return null;

  if (right) return pack(right, pose);
  if (left) return pack(mirror(left), mirror(pose));
  return null;
}

function pack(hand: NormalizedLandmark[], alignedPose: NormalizedLandmark[]) {
  if (
    hand.length !== handCount ||
    alignedPose.length !== poseCount ||
    !validPoints(hand) ||
    !validPose(alignedPose)
  ) {
    return null;
  }

  const features: number[] = [];
  push(features, hand);
  push(features, alignedPose);
  return features;
}

function mirror(points: NormalizedLandmark[]) {
  return points.map((point) => ({ ...point, x: 1 - point.x }));
}

function validPoints(points: NormalizedLandmark[]) {
  return points.every(validPoint);
}

function validPose(points: NormalizedLandmark[]) {
  return requiredPose.every(
    (index) => validPoint(points[index]) && inFrame(points[index]),
  );
}

function validPoint(point: NormalizedLandmark | undefined) {
  return (
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z ?? 0)
  );
}

function inFrame(point: NormalizedLandmark | undefined) {
  return (
    point !== undefined &&
    point.x >= min &&
    point.x <= max &&
    point.y >= min &&
    point.y <= max
  );
}

function push(features: number[], points: NormalizedLandmark[]) {
  for (const point of points) {
    features.push(point.x, point.y, point.z ?? 0);
  }
}
