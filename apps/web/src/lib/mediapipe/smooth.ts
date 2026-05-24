import { OneEuroFilter } from "1eurofilter";
import { cfg } from "@hand-wave/contract";
import type { Filters, HandFrame, SmoothParams } from "@/types/landmarks";

const smoothing = cfg.mp.smooth;

export function createSmoother() {
  const cache = new Map<string, Filters[]>();

  return {
    smooth(frame: HandFrame, timestampMs: number): HandFrame {
      const ts = timestampMs / 1_000;
      const active = new Set<string>();

      const smoothSets = (name: string, sets: HandFrame["rightHandLandmarks"]) =>
        sets.map((landmarks, index) => {
          const key = `${name}:${index}`;
          active.add(key);
          const params = name === "pose" ? smoothing.pose : smoothing.hand;
          return smoothPoints(
            landmarks,
            ts,
            filtersFor(cache, key, landmarks.length, params),
          );
        });

      const next = {
        rightHandLandmarks: smoothSets("right", frame.rightHandLandmarks),
        leftHandLandmarks: smoothSets("left", frame.leftHandLandmarks),
        poseLandmarks: smoothSets("pose", frame.poseLandmarks),
      };

      for (const key of cache.keys()) {
        if (!active.has(key)) cache.delete(key);
      }

      return next;
    },
    reset() {
      cache.clear();
    },
  };
}

function smoothPoints(
  landmarks: HandFrame["rightHandLandmarks"][number],
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
  cache: Map<string, Filters[]>,
  key: string,
  count: number,
  params: SmoothParams,
) {
  const existing = cache.get(key);
  if (existing?.length === count) return existing;

  const next = Array.from({ length: count }, () => newFilters(params));
  cache.set(key, next);
  return next;
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
