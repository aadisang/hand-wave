import createClient from "openapi-fetch";
import { env } from "@/config/env";
import type { paths } from "@/lib/inference/generated/openapi";
import { setInferenceConnectionStatus } from "@/lib/inference/connection";
import {
  compactFrames,
  recognizeOverWebSocket,
  resetInferenceStream as resetSocket,
} from "@/lib/inference/socket";
import type { Frame, RecognizeIn, RecognizeOut } from "@/types/inference";

class StatusError extends Error {
  constructor(readonly status: number) {
    super(`Inference request failed with status ${status}`);
  }
}

const client = createClient<paths>({ baseUrl: env.VITE_INFERENCE_URL });
const predictTimeoutMs = 12_000;
const streamTimeoutMs = 3_000;
const warmupTimeoutMs = 120_000;
const socketRetryMs = 5_000;
const landmarkFrameSize = 162;
const warmupFrame: Frame = Array(landmarkFrameSize).fill(0);
let warmup: Promise<void> | null = null;
let socketRetryAfter = 0;

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
) {
  return recognizeWithFallback(payload, timeoutMs);
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

export function resetInferenceStream() {
  socketRetryAfter = 0;
  resetSocket();
}

async function recognizeWithFallback(
  payload: RecognizeIn,
  timeoutMs: number,
): Promise<RecognizeOut> {
  if (Date.now() >= socketRetryAfter) {
    try {
      return await recognizeOverWebSocket(payload, timeoutMs);
    } catch {
      socketRetryAfter = Date.now() + socketRetryMs;
    }
  }
  return recognizeOverHTTP(payload, timeoutMs);
}

async function recognizeOverHTTP(
  payload: RecognizeIn,
  timeoutMs: number,
): Promise<RecognizeOut> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const result = await client.POST("/v1/recognize", {
      body: {
        ...payload,
        frames: payload.frames ? compactFrames(payload.frames) : undefined,
      },
      signal: ctrl.signal,
    });
    if (!result.response.ok) throw new StatusError(result.response.status);
    if (!result.data) {
      throw new Error("Recognition response did not include a JSON body");
    }
    setInferenceConnectionStatus("ready");
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}
