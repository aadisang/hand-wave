import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { cfg } from "@hand-wave/contract";
import { env } from "@/config/env";
import {
  SessionInfoSchema,
  SessionStateSchema,
  StreamPredSchema,
} from "@/lib/inference/schema";
import type { Frame } from "@/types/inference";

class RequestErr extends Data.TaggedError("RequestErr")<{
  cause: unknown;
}> {}

class StatusErr extends Data.TaggedError("StatusErr")<{
  status: number;
}> {}

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

export const createSession = Effect.fn("createSession")(
  function* () {
    const response = yield* jsonRequest(
      sessionsUrl,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          max_window_frames: cfg.session.window,
          min_stable_frames: cfg.session.stable,
        }),
      },
      SessionInfoSchema,
    );

    return response.session_id;
  },
);

export const appendFrames = Effect.fn("appendFrames")(
  (sessionId: string, frames: Frame[]) =>
    jsonRequest(
      new URL(`/v1/sessions/${sessionId}/frames`, env.VITE_INFERENCE_URL),
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ frames }),
      },
      StreamPredSchema,
    ),
);

export const deleteSession = Effect.fn("deleteSession")(
  (sessionId: string) =>
    Effect.tryPromise({
      try: () =>
        fetch(new URL(`/v1/sessions/${sessionId}`, env.VITE_INFERENCE_URL), {
          method: "DELETE",
        }),
      catch: (cause) => new RequestErr({ cause }),
    }),
);

export const resetSession = Effect.fn("resetSession")(
  (sessionId: string) =>
    jsonRequest(
      new URL(`/v1/sessions/${sessionId}/reset`, env.VITE_INFERENCE_URL),
      { method: "POST" },
      SessionStateSchema,
    ),
);

export function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

export function runExit<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.exit(effect));
}
