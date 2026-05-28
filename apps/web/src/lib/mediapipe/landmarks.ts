import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Frame } from "@/types/inference";
import type { HandFrame, HandSide } from "@/types/landmarks";

export type ModelInput = {
  features: Frame;
  frame: HandFrame;
};

export type ActiveHandSelector = {
  select: (frame: HandFrame) => HandSide | null;
  reset: () => void;
};

const handCount = 21;
const poseCount = 33;
const requiredPose = [0, 11, 12];
const min = -0.15;
const max = 1.15;
const switchMotionMargin = 0.012;
const minSwitchMotion = 0.015;

export function toFrame(frame: HandFrame): Frame | null {
  return toModelInput(frame)?.features ?? null;
}

export function toModelInput(
  frame: HandFrame,
  selectedHand?: HandSide | null,
): ModelInput | null {
  const right = frame.rightHandLandmarks[0];
  const left = frame.leftHandLandmarks[0];
  const pose = frame.poseLandmarks[0];
  if (!pose) return null;

  const side =
    selectedHand && handFor(frame, selectedHand)
      ? selectedHand
      : right
        ? "Right"
        : left
          ? "Left"
          : null;
  if (!side) return null;

  const hand = handFor(frame, side);
  if (!hand) return null;

  const features =
    side === "Left" ? pack(mirror(hand), mirror(pose)) : pack(hand, pose);
  if (!features) return null;

  return {
    features,
    frame: {
      rightHandLandmarks: side === "Right" ? [hand] : [],
      leftHandLandmarks: side === "Left" ? [hand] : [],
      poseLandmarks: [pose],
    },
  };
}

export function createActiveHandSelector(): ActiveHandSelector {
  let active: HandSide | null = null;
  let previous: Partial<Record<HandSide, NormalizedLandmark[]>> = {};

  return {
    select(frame) {
      const right = frame.rightHandLandmarks[0];
      const left = frame.leftHandLandmarks[0];
      if (!right && !left) {
        active = null;
        previous = {};
        return null;
      }

      const next = selectActiveHand({ active, previous, right, left });
      active = next;
      previous = {
        ...(right ? { Right: right } : {}),
        ...(left ? { Left: left } : {}),
      };
      return next;
    },
    reset() {
      active = null;
      previous = {};
    },
  };
}

function selectActiveHand({
  active,
  previous,
  right,
  left,
}: {
  active: HandSide | null;
  previous: Partial<Record<HandSide, NormalizedLandmark[]>>;
  right?: NormalizedLandmark[];
  left?: NormalizedLandmark[];
}): HandSide | null {
  if (right && !left) return "Right";
  if (left && !right) return "Left";
  if (!right || !left) return null;

  const rightMotion = motion(previous.Right, right);
  const leftMotion = motion(previous.Left, left);

  if (active && handFromCandidates(active, right, left)) {
    const other = active === "Right" ? "Left" : "Right";
    const activeMotion = active === "Right" ? rightMotion : leftMotion;
    const otherMotion = other === "Right" ? rightMotion : leftMotion;
    if (
      otherMotion > minSwitchMotion &&
      otherMotion > activeMotion + switchMotionMargin
    ) {
      return other;
    }
    return active;
  }

  if (Math.abs(leftMotion - rightMotion) > switchMotionMargin) {
    return leftMotion > rightMotion ? "Left" : "Right";
  }

  return handSpan(left) > handSpan(right) ? "Left" : "Right";
}

function handFromCandidates(
  side: HandSide,
  right: NormalizedLandmark[],
  left: NormalizedLandmark[],
) {
  return side === "Right" ? right : left;
}

function handFor(frame: HandFrame, side: HandSide) {
  return side === "Right"
    ? frame.rightHandLandmarks[0]
    : frame.leftHandLandmarks[0];
}

function motion(
  previous: NormalizedLandmark[] | undefined,
  current: NormalizedLandmark[],
) {
  if (!previous || previous.length !== current.length) return 0;
  let total = 0;
  for (let index = 0; index < current.length; index += 1) {
    const a = previous[index];
    const b = current[index];
    total += Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
  }
  return total / current.length;
}

function handSpan(points: NormalizedLandmark[]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
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
