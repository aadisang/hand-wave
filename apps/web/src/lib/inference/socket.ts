import { env } from "@/config/env";
import { setInferenceConnectionStatus } from "@/lib/inference/connection";
import type { components } from "@/lib/inference/generated/openapi";
import type { Frame, RecognizeIn, RecognizeOut } from "@/types/inference";
import { WebSocket as PartySocket } from "partysocket";

const warmupTimeoutMs = 120_000;
const streamProtocol = 1;
const streamSubprotocol = "handwave.v1";
const reconnectCode = 4000;

type StreamResponse = components["schemas"]["StreamResponse"];
type StreamRequest = components["schemas"]["StreamRequest"];
type WithoutSequence<T> = T extends { sequence: number }
  ? Omit<T, "sequence">
  : never;
type StreamRequestBody = WithoutSequence<StreamRequest>;

type PendingRequest = {
  resolve: (response: StreamResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SocketOwner = {
  socket: PartySocket;
  pending: Map<number, PendingRequest>;
  closed: boolean;
  ready: boolean;
};

type ConnectionAttempt = {
  owner: SocketOwner;
  promise: Promise<SocketOwner>;
};

export class InferenceSocket {
  private owner: SocketOwner | null = null;
  private connectionAttempt: ConnectionAttempt | null = null;
  private sequence = 0;
  private generation = 0;
  private lastSentFrame: Frame | null = null;
  private needsResync = true;
  private requestQueue: Promise<void> = Promise.resolve();

  prepare(timeoutMs = warmupTimeoutMs) {
    return this.open(timeoutMs).then(() => undefined);
  }

  recognize(payload: RecognizeIn, timeoutMs: number): Promise<RecognizeOut> {
    const generation = this.generation;
    const result = this.requestQueue.then(() => {
      if (generation !== this.generation) {
        throw new Error("Inference stream was reset");
      }
      return this.recognizeNow(payload, timeoutMs, generation);
    });
    this.requestQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  clearRecognition(timeoutMs: number): Promise<void> {
    const generation = this.generation;
    const result = this.requestQueue.then(() =>
      this.clearRecognitionNow(timeoutMs, generation),
    );
    this.requestQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  close() {
    this.generation += 1;
    const owner = this.owner;
    this.owner = null;
    this.connectionAttempt = null;
    this.lastSentFrame = null;
    this.needsResync = true;
    if (owner)
      this.discardOwner(owner, new Error("Inference stream was reset"));
    setInferenceConnectionStatus("idle");
  }

  private async recognizeNow(
    payload: RecognizeIn,
    timeoutMs: number,
    generation: number,
  ) {
    const owner = await this.open(warmupTimeoutMs);
    if (generation !== this.generation || owner !== this.owner) {
      throw new Error("Inference stream was reset");
    }

    const frames = payload.frames ?? [];
    const { delta, resync, cursorLost } = streamFrameDelta(
      frames,
      this.lastSentFrame,
      this.needsResync,
    );
    if (cursorLost) {
      await this.resetOwner(owner, timeoutMs);
    }
    const response = await this.exchange(
      owner,
      {
        ...payload,
        type: "recognize",
        protocol: streamProtocol,
        frames: compactFrames(delta),
        state: resync ? payload.state : undefined,
      },
      timeoutMs,
    );
    if (response.type === "error") {
      throw new Error(response.detail);
    }
    if (response.type !== "result") {
      const error = new Error("Invalid inference stream response");
      this.discardOwner(owner, error);
      setInferenceConnectionStatus("error");
      throw error;
    }
    if (generation !== this.generation || owner !== this.owner) {
      throw new Error("Inference stream was reset");
    }

    this.needsResync = false;
    this.lastSentFrame = payload.finalize ? null : (frames.at(-1) ?? null);
    return response.result;
  }

  private async clearRecognitionNow(timeoutMs: number, generation: number) {
    if (generation !== this.generation) return;
    this.lastSentFrame = null;
    this.needsResync = true;

    const owner = this.owner;
    if (
      !owner?.ready ||
      owner.closed ||
      owner.socket.readyState !== PartySocket.OPEN
    ) {
      return;
    }

    await this.resetOwner(owner, timeoutMs);
  }

  private async resetOwner(owner: SocketOwner, timeoutMs: number) {
    const response = await this.exchange(
      owner,
      { type: "reset", protocol: streamProtocol },
      timeoutMs,
    );
    if (response.type === "reset") return;
    const error = new Error("Invalid inference stream reset response");
    this.discardOwner(owner, error);
    throw error;
  }

  private open(timeoutMs: number): Promise<SocketOwner> {
    if (typeof globalThis.WebSocket === "undefined") {
      return Promise.reject(new Error("WebSocket is unavailable"));
    }
    if (
      this.owner?.ready &&
      this.owner.socket.readyState === PartySocket.OPEN
    ) {
      return Promise.resolve(this.owner);
    }
    if (this.connectionAttempt) return this.connectionAttempt.promise;

    setInferenceConnectionStatus("connecting");
    const owner = this.owner ?? this.createOwner();

    const attempt: ConnectionAttempt = {
      owner,
      promise: this.finishOpening(owner, timeoutMs),
    };
    this.connectionAttempt = attempt;
    const clearAttempt = () => {
      if (this.connectionAttempt === attempt) this.connectionAttempt = null;
    };
    void attempt.promise.then(clearAttempt, clearAttempt);
    return attempt.promise;
  }

  private createOwner(): SocketOwner {
    const socket = new PartySocket(
      inferenceWebSocketURL().toString(),
      [streamSubprotocol],
      {
        WebSocket: globalThis.WebSocket,
        connectionTimeout: warmupTimeoutMs,
        minReconnectionDelay: 500,
        maxReconnectionDelay: 5_000,
        reconnectionDelayGrowFactor: 1.5,
        minUptime: 2_000,
        maxEnqueuedMessages: 0,
      },
    );
    const owner: SocketOwner = {
      socket,
      pending: new Map(),
      closed: false,
      ready: false,
    };
    this.owner = owner;
    this.bind(owner);
    return owner;
  }

  private async finishOpening(owner: SocketOwner, timeoutMs: number) {
    try {
      await this.waitForOpen(owner, timeoutMs);
      const response = await this.exchange(
        owner,
        { type: "ping", protocol: streamProtocol },
        timeoutMs,
      );
      if (response.type !== "pong") {
        throw new Error("Inference WebSocket handshake failed");
      }
      if (owner !== this.owner)
        throw new Error("Inference stream was replaced");
      owner.ready = true;
      setInferenceConnectionStatus("ready");
      return owner;
    } catch (cause) {
      const error = asError(cause, "Inference WebSocket connection failed");
      const wasCurrentOwner = owner === this.owner;
      this.interruptOwner(owner, error);
      if (wasCurrentOwner) {
        setInferenceConnectionStatus("error");
        if (owner.socket.readyState === PartySocket.OPEN) {
          owner.socket.reconnect(reconnectCode, "handshake failed");
        }
      }
      throw error;
    }
  }

  private waitForOpen(owner: SocketOwner, timeoutMs: number) {
    if (owner.socket.readyState === PartySocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Inference WebSocket connection timed out"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        owner.socket.removeEventListener("open", onOpen);
        owner.socket.removeEventListener("error", onError);
        owner.socket.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Inference WebSocket connection failed"));
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Inference WebSocket closed during connection"));
      };
      owner.socket.addEventListener("open", onOpen);
      owner.socket.addEventListener("error", onError);
      owner.socket.addEventListener("close", onClose);
    });
  }

  private bind(owner: SocketOwner) {
    owner.socket.addEventListener("open", () => {
      if (owner.closed || owner !== this.owner) return;
      owner.ready = false;
      setInferenceConnectionStatus("connecting");
    });
    owner.socket.addEventListener("message", (event) => {
      try {
        const response = parseStreamResponse(event.data);
        if (response.protocol !== streamProtocol) {
          throw new Error("Unsupported inference stream protocol");
        }
        const pending = owner.pending.get(response.sequence);
        if (!pending) return;
        owner.pending.delete(response.sequence);
        clearTimeout(pending.timer);
        pending.resolve(response);
      } catch (cause) {
        this.discardOwner(
          owner,
          asError(cause, "Invalid inference stream response"),
        );
        setInferenceConnectionStatus("error");
      }
    });
    owner.socket.addEventListener("error", () => {
      this.interruptOwner(
        owner,
        new Error("Inference WebSocket request failed"),
      );
      if (!owner.closed && owner === this.owner) {
        setInferenceConnectionStatus("error");
      }
    });
    owner.socket.addEventListener("close", () => {
      this.interruptOwner(owner, new Error("Inference WebSocket closed"));
      if (!owner.closed && owner === this.owner) {
        setInferenceConnectionStatus("connecting");
      }
    });
  }

  private exchange(
    owner: SocketOwner,
    body: StreamRequestBody,
    timeoutMs: number,
  ) {
    if (owner.closed || owner !== this.owner) {
      return Promise.reject(new Error("Inference WebSocket is not active"));
    }
    const sequence = ++this.sequence;
    return new Promise<StreamResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("Inference WebSocket response timed out");
        this.interruptOwner(owner, error);
        if (owner === this.owner && !owner.closed) {
          owner.socket.reconnect(reconnectCode, "response timed out");
        }
      }, timeoutMs);
      owner.pending.set(sequence, { resolve, reject, timer });
      try {
        const sent = owner.socket.send(JSON.stringify({ ...body, sequence }));
        if (!sent) {
          this.interruptOwner(
            owner,
            new Error("Inference WebSocket was not ready"),
          );
        }
      } catch (cause) {
        this.interruptOwner(
          owner,
          asError(cause, "Inference WebSocket send failed"),
        );
      }
    });
  }

  private interruptOwner(owner: SocketOwner, error: Error) {
    owner.ready = false;
    for (const pending of owner.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    owner.pending.clear();
    if (this.owner !== owner) return;
    this.lastSentFrame = null;
    this.needsResync = true;
  }

  private discardOwner(owner: SocketOwner, error: Error) {
    if (owner.closed) return;
    owner.closed = true;
    this.interruptOwner(owner, error);
    owner.socket.close(1000, "stream closed");
    if (this.owner !== owner) return;
    this.owner = null;
    setInferenceConnectionStatus("idle");
  }
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
  const cursorLost = !requiresResync && cursorFrame !== null && cursor < 0;
  const resync = requiresResync || cursorLost;
  const delta =
    resync || cursorFrame === null ? frames : frames.slice(cursor + 1);
  return { delta, resync, cursorLost };
}

export function compactFrames(frames: Frame[]) {
  return frames.map((frame) =>
    frame.map((value) => Math.round(value * 10_000) / 10_000),
  );
}

function asError(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause : new Error(fallback);
}

function parseStreamResponse(value: unknown): StreamResponse {
  if (typeof value !== "string") {
    throw new Error("Inference stream response was not text");
  }
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    typeof parsed.type !== "string" ||
    !("protocol" in parsed) ||
    typeof parsed.protocol !== "number" ||
    !("sequence" in parsed) ||
    typeof parsed.sequence !== "number"
  ) {
    throw new Error("Inference stream response had an invalid envelope");
  }
  if (
    (parsed.type === "result" &&
      (!("result" in parsed) ||
        !parsed.result ||
        typeof parsed.result !== "object")) ||
    (parsed.type === "error" &&
      (!("detail" in parsed) || typeof parsed.detail !== "string")) ||
    !["pong", "reset", "result", "error"].includes(parsed.type)
  ) {
    throw new Error("Inference stream response had an invalid payload");
  }
  return parsed as StreamResponse;
}
