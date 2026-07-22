import createClient from "openapi-fetch";
import { env } from "@/config/env";
import type { paths } from "@/lib/inference/generated/openapi";
import { compactFrames, InferenceSocket } from "@/lib/inference/socket";
import type { Frame, RecognizeIn, RecognizeOut } from "@/types/inference";

class StatusError extends Error {
  constructor(readonly status: number) {
    super(`Inference request failed with status ${status}`);
  }
}

const client = createClient<paths>({ baseUrl: env.VITE_INFERENCE_URL });
const predictTimeoutMs = 12_000;
// Native model work keeps running after a client timeout. Leave enough time for
// a queued decode instead of dropping a result that may still arrive.
const streamTimeoutMs = 30_000;
const warmupTimeoutMs = 120_000;
const landmarkFrameSize = 162;
const warmupFrame: Frame = Array(landmarkFrameSize).fill(0);
const inferenceSocket = new InferenceSocket();
let warmup: Promise<void> | null = null;

export async function predictFrames(
  frames: Frame[],
  timeoutMs = predictTimeoutMs,
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const result = await client.POST("/v1/predict", {
      body: { frames: compactFrames(frames) },
      signal: ctrl.signal,
    });
    if (!result.response.ok) throw new StatusError(result.response.status);
    if (!result.data) {
      throw new Error("Inference response did not include a JSON body");
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

export function recognizeFrames(
  payload: RecognizeIn,
  timeoutMs = streamTimeoutMs,
): Promise<RecognizeOut> {
  return inferenceSocket.recognize(payload, timeoutMs);
}

export function warmInference() {
  // Warm the model without reserving a long-lived WebSocket for an idle page.
  warmup ??= predictFrames([warmupFrame], warmupTimeoutMs)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      warmup = null;
    });
  return warmup;
}

export function prepareInferenceStream() {
  return inferenceSocket.prepare();
}

export function clearInferenceSession() {
  return inferenceSocket.clearRecognition(streamTimeoutMs);
}

export function closeInferenceStream() {
  inferenceSocket.close();
}
