import { OneEuroFilter } from "1eurofilter";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { cfg } from "@hand-wave/contract";

const smoothing = cfg.mp.smooth;

type SmoothKind = keyof typeof smoothing;
type SmoothParams = (typeof smoothing)[SmoothKind];
type Filters = {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
};

export function createSmoother(kind: SmoothKind) {
  const params = smoothing[kind];
  let cache: Filters[][] = [];

  return {
    smooth(sets: NormalizedLandmark[][], timestampMs: number) {
      const ts = timestampMs / 1_000;
      const nextCache: Filters[][] = [];
      const smoothed = sets.map((landmarks, index) => {
        const filters = filtersFor(cache[index], landmarks.length, params);
        nextCache.push(filters);
        return smoothPoints(landmarks, ts, filters);
      });
      cache = nextCache;
      return smoothed;
    },
    reset() {
      cache = [];
    },
  };
}

function smoothPoints(
  landmarks: NormalizedLandmark[],
  timestamp: number,
  filters: Filters[],
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
  existing: Filters[] | undefined,
  count: number,
  params: SmoothParams,
) {
  if (existing?.length === count) return existing;

  return Array.from({ length: count }, () => newFilters(params));
}

function newFilters(params: SmoothParams): Filters {
  return {
    x: newFilter(params),
    y: newFilter(params),
    z: newFilter(params),
  };
}

function newFilter(params: SmoothParams) {
  return new OneEuroFilter(
    params.freq,
    params.cutoff,
    params.beta,
    params.dCutoff,
  );
}
