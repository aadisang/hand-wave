import { OneEuroFilter } from "1eurofilter";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { inferenceConfig } from "@/config/inference";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";

type LandmarkFilters = {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
};

const smoothing = inferenceConfig.mediapipe.smoothing;
type SmoothingParams = {
  frequency: number;
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
};

export function createLandmarkSmoother() {
  const filters = new Map<string, LandmarkFilters[]>();

  return {
    smooth(frame: HandLandmarksFrame, timestampMs: number): HandLandmarksFrame {
      const timestamp = timestampMs / 1_000;
      const activeKeys = new Set<string>();

      const smoothGroup = (name: string, groups: NormalizedLandmark[][]) =>
        groups.map((landmarks, index) => {
          const key = `${name}:${index}`;
          activeKeys.add(key);
          const params = name === "pose" ? smoothing.pose : smoothing.hand;
          return smoothLandmarks(
            landmarks,
            timestamp,
            filtersFor(filters, key, landmarks.length, params),
          );
        });

      const smoothed = {
        rightHandLandmarks: smoothGroup("right", frame.rightHandLandmarks),
        leftHandLandmarks: smoothGroup("left", frame.leftHandLandmarks),
        poseLandmarks: smoothGroup("pose", frame.poseLandmarks),
      };

      for (const key of filters.keys()) {
        if (!activeKeys.has(key)) filters.delete(key);
      }

      return smoothed;
    },
    reset() {
      filters.clear();
    },
  };
}

function smoothLandmarks(
  landmarks: NormalizedLandmark[],
  timestamp: number,
  filters: LandmarkFilters[],
) {
  return landmarks.map((landmark, index) => {
    const filter = filters[index];
    return {
      ...landmark,
      x: filter.x.filter(landmark.x, timestamp),
      y: filter.y.filter(landmark.y, timestamp),
      z: filter.z.filter(landmark.z ?? 0, timestamp),
    };
  });
}

function filtersFor(
  cache: Map<string, LandmarkFilters[]>,
  key: string,
  count: number,
  params: SmoothingParams,
) {
  const existing = cache.get(key);
  if (existing?.length === count) return existing;

  const next = Array.from({ length: count }, () => createFilters(params));
  cache.set(key, next);
  return next;
}

function createFilters(params: SmoothingParams): LandmarkFilters {
  return {
    x: createFilter(params),
    y: createFilter(params),
    z: createFilter(params),
  };
}

function createFilter(params: SmoothingParams) {
  return new OneEuroFilter(
    params.frequency,
    params.minCutoff,
    params.beta,
    params.derivativeCutoff,
  );
}
