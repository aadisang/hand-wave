import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import createClient from "openapi-fetch";
import { env } from "@/config/env";
import type { paths } from "@/lib/inference/openapi";
import type { Frame, RecognizeIn } from "@/types/inference";

class RequestErr extends Data.TaggedError("RequestErr")<{
  cause: unknown;
}> {}

class StatusErr extends Data.TaggedError("StatusErr")<{
  status: number;
}> {}

const client = createClient<paths>({ baseUrl: env.VITE_INFERENCE_URL });
const predictTimeoutMs = 12_000;
const warmupTimeoutMs = 120_000;
const landmarkFrameSize = 162;
const warmupFrame: Frame = Array(landmarkFrameSize).fill(0);
let warmup: Promise<void> | null = null;

function compactFrames(frames: Frame[]) {
  return frames.map((frame) =>
    frame.map((value) => Math.round(value * 10_000) / 10_000),
  );
}

export const predictFrames = Effect.fn("predictFrames")(
  (frames: Frame[], timeoutMs = predictTimeoutMs) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          return client
            .POST("/v1/predict", {
              body: { frames: compactFrames(frames) },
              signal: ctrl.signal,
            })
            .finally(() => clearTimeout(timer));
        },
        catch: (cause) => new RequestErr({ cause }),
      });

      if (!result.response.ok) {
        return yield* new StatusErr({ status: result.response.status });
      }
      if (!result.data) {
        return yield* new RequestErr({
          cause: new Error("Inference response did not include a JSON body"),
        });
      }
      return result.data;
    }),
);

export const recognizeFrames = Effect.fn("recognizeFrames")(
  (payload: RecognizeIn, timeoutMs = predictTimeoutMs) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          return client
            .POST("/v1/recognize", {
              body: {
                ...payload,
                frames: payload.frames
                  ? compactFrames(payload.frames as Frame[])
                  : undefined,
              },
              signal: ctrl.signal,
            })
            .finally(() => clearTimeout(timer));
        },
        catch: (cause) => new RequestErr({ cause }),
      });

      if (!result.response.ok) {
        return yield* new StatusErr({ status: result.response.status });
      }
      if (!result.data) {
        return yield* new RequestErr({
          cause: new Error("Recognition response did not include a JSON body"),
        });
      }
      return result.data;
    }),
);

export function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

export function warmInference() {
  warmup ??= run(predictFrames([warmupFrame], warmupTimeoutMs))
    .then(() => undefined)
    .finally(() => {
      warmup = null;
    });
  return warmup;
}
