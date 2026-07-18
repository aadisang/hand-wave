import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import createClient from "openapi-fetch";
import { env } from "@/config/env";
import type { paths } from "@/lib/inference/openapi";
import type { Frame, RecognizeIn, RecognizeOut } from "@/types/inference";

class RequestErr extends Data.TaggedError("RequestErr")<{
  cause: unknown;
}> {}

class StatusErr extends Data.TaggedError("StatusErr")<{
  status: number;
}> {}

const client = createClient<paths>({ baseUrl: env.VITE_INFERENCE_URL });
const predictTimeoutMs = 12_000;
const streamTimeoutMs = 3_000;
const warmupTimeoutMs = 120_000;
const socketRetryMs = 5_000;
const streamProtocol = 1;
const streamSubprotocol = "handwave.v1";
const landmarkFrameSize = 162;
const warmupFrame: Frame = Array(landmarkFrameSize).fill(0);
let warmup: Promise<void> | null = null;
let socket: WebSocket | null = null;
let socketReady: Promise<WebSocket> | null = null;
let socketSequence = 0;
let socketRetryAfter = 0;
let lastSentFrame: Frame | null = null;
let needsResync = true;

type StreamResponse = {
  type: "pong" | "reset" | "result" | "error";
  sequence: number;
  protocol: number;
  result?: RecognizeOut;
  detail?: string;
};

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
  (payload: RecognizeIn, timeoutMs = streamTimeoutMs) =>
    Effect.gen(function* () {
      return yield* Effect.tryPromise({
        try: () => recognizeWithFallback(payload, timeoutMs),
        catch: (cause) =>
          cause instanceof StatusErr ? cause : new RequestErr({ cause }),
      });
    }),
);

export function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

export function warmInference() {
  // Warm the model without reserving a long-lived WebSocket for an idle page.
  warmup ??= run(predictFrames([warmupFrame], warmupTimeoutMs))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      warmup = null;
    });
  return warmup;
}

export function resetInferenceStream() {
  closeInferenceSocket();
  socketRetryAfter = 0;
}

export function inferenceWebSocketURL(baseURL = env.VITE_INFERENCE_URL) {
  const url = new URL("/v1/stream", baseURL);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error(`Unsupported inference URL protocol: ${url.protocol}`);
  return url;
}

export function streamFrameDelta(
  frames: Frame[],
  cursorFrame: Frame | null,
  requiresResync: boolean,
) {
  const cursor = cursorFrame ? frames.lastIndexOf(cursorFrame) : -1;
  const resync = requiresResync || (cursorFrame !== null && cursor < 0);
  const delta =
    resync || cursorFrame === null ? frames : frames.slice(cursor + 1);
  return { delta, resync };
}

async function recognizeWithFallback(
  payload: RecognizeIn,
  timeoutMs: number,
): Promise<RecognizeOut> {
  if (Date.now() >= socketRetryAfter) {
    try {
      return await recognizeOverWebSocket(payload, timeoutMs);
    } catch {
      closeInferenceSocket();
      socketRetryAfter = Date.now() + socketRetryMs;
    }
  }
  return recognizeOverHTTP(payload, timeoutMs);
}

async function recognizeOverWebSocket(
  payload: RecognizeIn,
  timeoutMs: number,
): Promise<RecognizeOut> {
  const activeSocket = await openInferenceSocket(warmupTimeoutMs);
  const frames = (payload.frames ?? []) as Frame[];
  const { delta, resync } = streamFrameDelta(
    frames,
    lastSentFrame,
    needsResync,
  );
  const sequence = ++socketSequence;
  const response = await exchange(
    activeSocket,
    {
      ...payload,
      type: "recognize",
      protocol: streamProtocol,
      sequence,
      frames: compactFrames(delta),
      state: resync ? payload.state : undefined,
    },
    sequence,
    timeoutMs,
  );
  if (response.type !== "result" || !response.result) {
    throw new Error(response.detail ?? "Invalid inference stream response");
  }

  needsResync = false;
  if (payload.finalize) lastSentFrame = null;
  else if (frames.length > 0) lastSentFrame = frames.at(-1) ?? null;
  return response.result;
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
        frames: payload.frames
          ? compactFrames(payload.frames as Frame[])
          : undefined,
      },
      signal: ctrl.signal,
    });
    if (!result.response.ok)
      throw new StatusErr({ status: result.response.status });
    if (!result.data) {
      throw new Error("Recognition response did not include a JSON body");
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

function openInferenceSocket(timeoutMs: number): Promise<WebSocket> {
  if (typeof WebSocket === "undefined") {
    return Promise.reject(new Error("WebSocket is unavailable"));
  }
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (socketReady) return socketReady;

  socketReady = new Promise<WebSocket>((resolve, reject) => {
    const candidate = new WebSocket(inferenceWebSocketURL(), [
      streamSubprotocol,
    ]);
    socket = candidate;
    const timer = setTimeout(() => {
      candidate.close();
      reject(new Error("Inference WebSocket connection timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      candidate.removeEventListener("open", onOpen);
      candidate.removeEventListener("error", onError);
      candidate.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve(candidate);
    };
    const onError = () => {
      cleanup();
      reject(new Error("Inference WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Inference WebSocket closed during connection"));
    };
    candidate.addEventListener("open", onOpen);
    candidate.addEventListener("error", onError);
    candidate.addEventListener("close", onClose);
  })
    .then(async (activeSocket) => {
      const sequence = ++socketSequence;
      const response = await exchange(
        activeSocket,
        { type: "ping", protocol: streamProtocol, sequence },
        sequence,
        timeoutMs,
      );
      if (response.type !== "pong") {
        throw new Error("Inference WebSocket handshake failed");
      }
      return activeSocket;
    })
    .catch((cause) => {
      closeInferenceSocket();
      throw cause;
    })
    .finally(() => {
      socketReady = null;
    });
  return socketReady;
}

function exchange(
  activeSocket: WebSocket,
  request: object,
  sequence: number,
  timeoutMs: number,
) {
  return new Promise<StreamResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      activeSocket.close();
      reject(new Error("Inference WebSocket response timed out"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      activeSocket.removeEventListener("message", onMessage);
      activeSocket.removeEventListener("error", onError);
      activeSocket.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent<string>) => {
      try {
        const response = JSON.parse(event.data) as StreamResponse;
        if (
          response.sequence !== sequence ||
          response.protocol !== streamProtocol
        ) {
          throw new Error("Out-of-order inference stream response");
        }
        cleanup();
        resolve(response);
      } catch (cause) {
        cleanup();
        reject(cause);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("Inference WebSocket request failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Inference WebSocket closed during request"));
    };
    activeSocket.addEventListener("message", onMessage);
    activeSocket.addEventListener("error", onError);
    activeSocket.addEventListener("close", onClose);
    activeSocket.send(JSON.stringify(request));
  });
}

function closeInferenceSocket() {
  socket?.close(1000, "stream reset");
  socket = null;
  socketReady = null;
  lastSentFrame = null;
  needsResync = true;
}
