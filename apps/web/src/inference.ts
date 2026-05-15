import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { env } from "./env";

const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
});

export type HealthResponse = typeof HealthResponse.Type;

export type Landmark = {
  x: number;
  y: number;
  z?: number | null;
};

export type LandmarkFrame = {
  landmarks: Landmark[];
  timestamp_ms?: number;
};

export type Prediction = {
  label: string;
  confidence: number;
};

export type PredictResponse = {
  prediction: Prediction;
  alternatives: Prediction[];
  partial_text: string;
  stable_text: string;
};

export type StreamPrediction = {
  session_id: string;
  buffered_frames: number;
  prediction: Prediction;
  alternatives: Prediction[];
  partial_text: string;
  stable_text: string;
};

class InferenceRequestError extends Data.TaggedError("InferenceRequestError")<{
  cause: unknown;
}> {}

class InferenceStatusError extends Data.TaggedError("InferenceStatusError")<{
  status: number;
}> {}

const healthUrl = new URL("/health", env.VITE_INFERENCE_URL);
const sessionsUrl = new URL("/v1/sessions", env.VITE_INFERENCE_URL);

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

export async function createInferenceSession() {
  const response = await fetch(sessionsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_window_frames: 160, min_stable_frames: 3 }),
  });

  if (!response.ok) {
    throw new Error(`Inference session failed: ${response.status}`);
  }

  const json = (await response.json()) as { session_id: string };
  return json.session_id;
}

export async function predictFrames(frames: LandmarkFrame[]) {
  const response = await fetch(new URL("/v1/predict", env.VITE_INFERENCE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "sequence", frames }),
  });

  if (!response.ok) {
    throw new Error(`Inference prediction failed: ${response.status}`);
  }

  return (await response.json()) as PredictResponse;
}

export async function appendInferenceFrames(
  sessionId: string,
  frames: LandmarkFrame[],
) {
  const response = await fetch(
    new URL(`/v1/sessions/${sessionId}/frames`, env.VITE_INFERENCE_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames }),
    },
  );

  if (!response.ok) {
    throw new Error(`Inference prediction failed: ${response.status}`);
  }

  return (await response.json()) as StreamPrediction;
}

export async function deleteInferenceSession(sessionId: string) {
  await fetch(new URL(`/v1/sessions/${sessionId}`, env.VITE_INFERENCE_URL), {
    method: "DELETE",
  });
}

export async function resetInferenceSession(sessionId: string) {
  const response = await fetch(
    new URL(`/v1/sessions/${sessionId}/reset`, env.VITE_INFERENCE_URL),
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(`Inference reset failed: ${response.status}`);
  }

  return (await response.json()) as {
    session_id: string;
    buffered_frames: number;
    partial_text: string;
    stable_text: string;
  };
}
