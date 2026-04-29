import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { env } from "./env";

const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
});

export type HealthResponse = typeof HealthResponse.Type;

class InferenceRequestError extends Data.TaggedError("InferenceRequestError")<{
  cause: unknown;
}> {}

class InferenceStatusError extends Data.TaggedError("InferenceStatusError")<{
  status: number;
}> {}

const healthUrl = new URL("/health", env.VITE_INFERENCE_URL);

export const getInferenceHealth = Effect.fn("getInferenceHealth")(function* () {
  const response = yield* Effect.tryPromise({
    try: () => fetch(healthUrl),
    catch: (cause) => new InferenceRequestError({ cause }),
  });

  if (!response.ok) {
    return yield* new InferenceStatusError({ status: response.status });
  }

  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => new InferenceRequestError({ cause }),
  });

  return yield* Schema.decodeUnknown(HealthResponse)(json);
});
