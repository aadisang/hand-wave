import createClient from "openapi-fetch";
import { env } from "@/config/env";
import type { paths } from "@/lib/inference/generated/openapi";
import { compactFrames, InferenceSocket } from "@/lib/inference/socket";
import { inferLocally, prepareLocalModel } from "@/lib/inference/local-model";
import type {
  Frame,
  FrameRecognizeIn,
  InferenceMode,
  RecognizeOut,
} from "@/types/inference";

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
const deviceInferenceURL =
  env.VITE_DEVICE_INFERENCE_URL ??
  (import.meta.env.PROD
    ? "https://sinarck--decoder.modal.run"
    : env.VITE_INFERENCE_URL);
const warmupFrame: Frame = Array(landmarkFrameSize).fill(0);
const remoteSocket = new InferenceSocket();
const deviceSocket = new InferenceSocket(deviceInferenceURL);
let warmup: Promise<void> | null = null;
let deviceWarmup: Promise<void> | null = null;

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
  mode: InferenceMode,
  payload: FrameRecognizeIn,
  timeoutMs = streamTimeoutMs,
): Promise<RecognizeOut> {
  if (mode === "remote") return remoteSocket.recognize(payload, timeoutMs);
  return recognizeWithLocalModel(payload, timeoutMs);
}

export function warmInference(mode: InferenceMode) {
  if (mode === "device") return prepareDeviceInference();
  // Warm the model without reserving a long-lived WebSocket for an idle page.
  warmup ??= predictFrames([warmupFrame], warmupTimeoutMs)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      warmup = null;
    });
  return warmup;
}

export async function prepareInferenceStream(mode: InferenceMode) {
  if (mode === "device") {
    await prepareDeviceInference();
    return;
  }
  await remoteSocket.prepare();
}

export function clearInferenceSession(mode: InferenceMode) {
  return socketFor(mode).clearRecognition(streamTimeoutMs);
}

export function closeInferenceStream(mode: InferenceMode) {
  socketFor(mode).close();
}

async function recognizeWithLocalModel(
  payload: FrameRecognizeIn,
  timeoutMs: number,
) {
  const emission = await inferLocally(payload.frames);
  return deviceSocket.recognize(
    {
      input: "emission",
      emission,
      state: payload.state,
      context: payload.context,
      finalize: payload.finalize,
    },
    timeoutMs,
  );
}

function socketFor(mode: InferenceMode) {
  return mode === "device" ? deviceSocket : remoteSocket;
}

function prepareDeviceInference() {
  deviceWarmup ??= Promise.all([prepareLocalModel(), deviceSocket.prepare()])
    .then(() => undefined)
    .finally(() => {
      deviceWarmup = null;
    });
  return deviceWarmup;
}
