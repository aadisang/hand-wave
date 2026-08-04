import { afterEach, describe, expect, test, vi } from "vitest";
import {
  InferenceSocket,
  inferenceWebSocketURL,
  streamFrameDelta,
} from "@/lib/inference/socket";
import type { Frame, FrameRecognizeIn } from "@/types/inference";

describe("inference WebSocket client", () => {
  afterEach(() => {
    FakeWebSocket.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("converts HTTP backend URLs to WebSocket URLs", () => {
    expect(inferenceWebSocketURL("http://localhost:8000").toString()).toBe(
      "ws://localhost:8000/v1/stream",
    );
    expect(inferenceWebSocketURL("https://inference.example").toString()).toBe(
      "wss://inference.example/v1/stream",
    );
  });

  test("sends only frames after the server cursor", () => {
    const frames = [frame(0), frame(1), frame(2), frame(3)];

    expect(streamFrameDelta(frames, frames[1] ?? null, false)).toEqual({
      delta: [frames[2], frames[3]],
      resync: false,
      cursorLost: false,
    });
  });

  test("resends the full window when the cursor fell out", () => {
    const frames = [frame(2), frame(3)];

    expect(streamFrameDelta(frames, frame(1), false)).toEqual({
      delta: frames,
      resync: true,
      cursorLost: true,
    });
  });

  test("does not report readiness before the handshake", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const first = client.prepare();
    const socket = await FakeWebSocket.instance(0);
    socket.open();
    const request = await socket.nextRequest("ping");

    let secondReady = false;
    const second = client.prepare().then(() => {
      secondReady = true;
    });
    await Promise.resolve();
    expect(secondReady).toBe(false);

    socket.receive({
      type: "pong",
      protocol: 1,
      sequence: request.sequence,
    });

    await Promise.all([first, second]);
    expect(secondReady).toBe(true);
    client.close();
  });

  test("an old connection failure cannot close its replacement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const first = client.prepare().catch((error: unknown) => error);
    const firstSocket = await FakeWebSocket.instance(0);
    client.close();

    const second = client.prepare();
    const secondSocket = await FakeWebSocket.instance(1);
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.open();
    const ping = await secondSocket.nextRequest("ping");
    secondSocket.receive({
      type: "pong",
      protocol: 1,
      sequence: ping.sequence,
    });

    await expect(second).resolves.toBeUndefined();
    await expect(first).resolves.toBeInstanceOf(Error);
    expect(secondSocket.readyState).toBe(FakeWebSocket.OPEN);
    client.close();
  });

  test("reconnects the same PartySocket after a network close", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const firstConnection = client.prepare();
    await vi.advanceTimersByTimeAsync(0);
    const firstSocket = await FakeWebSocket.instance(0);
    firstSocket.open();
    await respondToPing(firstSocket);
    await firstConnection;

    firstSocket.drop();
    await vi.advanceTimersByTimeAsync(5_000);
    const secondSocket = await FakeWebSocket.instance(1);
    secondSocket.open();
    const reconnected = client.prepare();
    await respondToPing(secondSocket);

    await expect(reconnected).resolves.toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.close();
  });

  test("resets recognition state without replacing a healthy socket", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const connection = client.prepare();
    const socket = await FakeWebSocket.instance(0);
    socket.open();
    await respondToPing(socket);
    await connection;

    const reset = client.clearRecognition(1_000);
    const request = await socket.nextRequest("reset");
    socket.receive({
      type: "reset",
      protocol: 1,
      sequence: request.sequence,
    });

    await expect(reset).resolves.toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    client.close();
  });

  test("clears local recognition state without opening a socket", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    await expect(client.clearRecognition(1_000)).resolves.toBeUndefined();

    expect(FakeWebSocket.instances).toHaveLength(0);
    client.close();
  });

  test("resets server state before a full-window cursor resync", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();
    const firstFrames = [frame(0), frame(1)];

    const first = client.recognize(recognizePayload(firstFrames), 1_000);
    const socket = await FakeWebSocket.instance(0);
    socket.open();
    await respondToPing(socket);
    await respondToRecognition(socket);
    await first;

    const secondFrames = [frame(2), frame(3)];
    const second = client.recognize(recognizePayload(secondFrames), 1_000);
    const reset = await socket.nextRequest("reset");
    socket.receive({ type: "reset", protocol: 1, sequence: reset.sequence });
    await respondToRecognition(socket);
    await second;

    const recognizeRequests = socket.sent
      .map((message) => JSON.parse(message) as Record<string, unknown>)
      .filter((request) => request.type === "recognize");
    expect(recognizeRequests).toHaveLength(2);
    expect(recognizeRequests[1]?.frames).toHaveLength(2);
    client.close();
  });

  test("sends local emissions without landmark frames", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket("https://decoder.example");
    const request = client.recognize(
      {
        input: "emission",
        emission: {
          values: [Array(60).fill(-1)],
          frame_confidence: 0.8,
        },
        context: {
          idle_frames: 0,
          missing_frames: 0,
          segment_frames: 18,
          motion: 0.1,
        },
      },
      1_000,
    );
    const socket = await FakeWebSocket.instance(0);
    socket.open();
    await respondToPing(socket);
    const payload = await socket.nextRequest("recognize");

    expect(payload.frames).toBeUndefined();
    expect(payload.emission).toMatchObject({ frame_confidence: 0.8 });
    respondToRecognitionRequest(socket, payload);
    await request;
    client.close();
  });

  test("sends a finalize-only request when no new frames arrived", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();
    const frames = [frame(0), frame(1)];

    const first = client.recognize(recognizePayload(frames), 1_000);
    const socket = await FakeWebSocket.instance(0);
    socket.open();
    await respondToPing(socket);
    await respondToRecognition(socket);
    await first;

    const final = client.recognize(
      { ...recognizePayload(frames), finalize: true },
      1_000,
    );
    const finalRequest = await socket.nextRequest("recognize");

    expect(finalRequest.input).toBe("finalize");
    expect(finalRequest).not.toHaveProperty("frames");
    respondToRecognitionRequest(socket, finalRequest);
    await final;
    client.close();
  });
});

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  private static instanceWaiters = new Map<
    number,
    Array<(socket: FakeWebSocket) => void>
  >();

  readonly sent: string[] = [];
  private readonly requests: StreamTestRequest[] = [];
  private requestCursor = 0;
  private requestWaiters: Array<{
    type: string;
    resolve: (request: StreamTestRequest) => void;
  }> = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    super();
    FakeWebSocket.instances.push(this);
    const index = FakeWebSocket.instances.length - 1;
    const waiters = FakeWebSocket.instanceWaiters.get(index) ?? [];
    FakeWebSocket.instanceWaiters.delete(index);
    for (const waiter of waiters) waiter(this);
  }

  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.instanceWaiters.clear();
  }

  static instance(index: number): Promise<FakeWebSocket> {
    const socket = FakeWebSocket.instances[index];
    if (socket) return Promise.resolve(socket);
    return new Promise((resolve) => {
      const waiters = FakeWebSocket.instanceWaiters.get(index) ?? [];
      waiters.push(resolve);
      FakeWebSocket.instanceWaiters.set(index, waiters);
    });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(data: string) {
    this.sent.push(data);
    const request = JSON.parse(data) as StreamTestRequest;
    this.requests.push(request);
    const waiterIndex = this.requestWaiters.findIndex(
      (waiter) => waiter.type === request.type,
    );
    if (waiterIndex < 0) return;
    const [waiter] = this.requestWaiters.splice(waiterIndex, 1);
    this.requestCursor = this.requests.length;
    waiter?.resolve(request);
  }

  nextRequest(type: string): Promise<StreamTestRequest> {
    const index = this.requests.findIndex(
      (request, index) => index >= this.requestCursor && request.type === type,
    );
    if (index >= 0) {
      this.requestCursor = index + 1;
      return Promise.resolve(this.requests[index] as StreamTestRequest);
    }
    return new Promise((resolve) => {
      this.requestWaiters.push({ type, resolve });
    });
  }

  receive(data: object) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  close(_code?: number, _reason?: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

async function respondToPing(socket: FakeWebSocket) {
  const request = await socket.nextRequest("ping");
  socket.receive({
    type: "pong",
    protocol: 1,
    sequence: request.sequence,
  });
}

async function respondToRecognition(socket: FakeWebSocket) {
  const request = await socket.nextRequest("recognize");
  respondToRecognitionRequest(socket, request);
}

function respondToRecognitionRequest(
  socket: FakeWebSocket,
  request: StreamTestRequest,
) {
  socket.receive({
    type: "result",
    protocol: 1,
    sequence: request.sequence,
    result: {
      state: {
        selected_text: "",
        selected_streak: 0,
        display_misses: 0,
        counts: [],
      },
      display_prediction: null,
      committed: false,
      trace: {},
    },
  });
}

type StreamTestRequest = Record<string, unknown> & {
  input?: string;
  sequence: number;
  type: string;
};

function recognizePayload(frames: Frame[]): FrameRecognizeIn {
  return {
    input: "frames",
    frames,
    context: {
      idle_frames: 0,
      missing_frames: 0,
      segment_frames: frames.length,
      motion: 0,
    },
  };
}

function frame(value: number): Frame {
  return Array(162).fill(value) as Frame;
}
