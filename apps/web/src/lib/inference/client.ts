import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { env } from "@/config/env";
import { InferOutSchema } from "@/lib/inference/schema";
import type { Frame } from "@/types/inference";

class RequestErr extends Data.TaggedError("RequestErr")<{
  cause: unknown;
}> {}

class StatusErr extends Data.TaggedError("StatusErr")<{
  status: number;
}> {}

const predictUrl = new URL("/v1/predict", env.VITE_INFERENCE_URL);
const jsonHeaders = { "Content-Type": "application/json" } as const;

function jsonRequest<A, I, R>(
  url: URL,
  init: RequestInit,
  schema: Schema.Schema<A, I, R>,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, init),
      catch: (cause) => new RequestErr({ cause }),
    });

    if (!response.ok) {
      return yield* new StatusErr({ status: response.status });
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new RequestErr({ cause }),
    });

    return yield* Schema.decodeUnknown(schema)(json);
  });
}

export const predictFrames = Effect.fn("predictFrames")((frames: Frame[]) =>
  jsonRequest(
    predictUrl,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ frames }),
    },
    InferOutSchema,
  ),
);

export function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}
