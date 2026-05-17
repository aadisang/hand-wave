import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { env } from "@/config/env";
import { inferenceConfig } from "@/config/inference";
import {
  CreateSessionResponseSchema,
  HealthResponseSchema,
  ResetSessionResponseSchema,
  StreamPredictionSchema,
} from "@/lib/inference/schemas";
import type { LandmarkFrame } from "@/types/inference";

class InferenceRequestError extends Data.TaggedError("InferenceRequestError")<{
  cause: unknown;
}> {}

class InferenceStatusError extends Data.TaggedError("InferenceStatusError")<{
  status: number;
}> {}

const healthUrl = new URL("/health", env.VITE_INFERENCE_URL);
const sessionsUrl = new URL("/v1/sessions", env.VITE_INFERENCE_URL);
const jsonHeaders = { "Content-Type": "application/json" } as const;

function jsonRequest<A, I, R>(
  url: URL,
  init: RequestInit,
  schema: Schema.Schema<A, I, R>,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, init),
      catch: (cause) => new InferenceRequestError({ cause }),
    });

    if (!response.ok) {
      return yield* new InferenceStatusError({ status: response.status });
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new InferenceRequestError({ cause }),
    });

    return yield* Schema.decodeUnknown(schema)(json);
  });
}

export const getInferenceHealth = Effect.fn("getInferenceHealth")(() =>
  jsonRequest(healthUrl, {}, HealthResponseSchema),
);

export const createInferenceSession = Effect.fn("createInferenceSession")(
  function* () {
    const response = yield* jsonRequest(
      sessionsUrl,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          max_window_frames: inferenceConfig.session.maxWindowFrames,
          min_stable_frames: inferenceConfig.session.minStableFrames,
        }),
      },
      CreateSessionResponseSchema,
    );

    return response.session_id;
  },
);

export const appendInferenceFrames = Effect.fn("appendInferenceFrames")(
  (sessionId: string, frames: LandmarkFrame[]) =>
    jsonRequest(
      new URL(`/v1/sessions/${sessionId}/frames`, env.VITE_INFERENCE_URL),
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ frames }),
      },
      StreamPredictionSchema,
    ),
);

export const deleteInferenceSession = Effect.fn("deleteInferenceSession")(
  (sessionId: string) =>
    Effect.tryPromise({
      try: () =>
        fetch(new URL(`/v1/sessions/${sessionId}`, env.VITE_INFERENCE_URL), {
          method: "DELETE",
        }),
      catch: (cause) => new InferenceRequestError({ cause }),
    }),
);

export const resetInferenceSession = Effect.fn("resetInferenceSession")(
  (sessionId: string) =>
    jsonRequest(
      new URL(`/v1/sessions/${sessionId}/reset`, env.VITE_INFERENCE_URL),
      { method: "POST" },
      ResetSessionResponseSchema,
    ),
);

export function runInference<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

export function runInferenceExit<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.exit(effect));
}
