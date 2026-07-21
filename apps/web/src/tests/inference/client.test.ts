import { afterEach, describe, expect, test, vi } from "vitest";
import {
  InferenceSocket,
  inferenceWebSocketURL,
  prepareInferenceStream,
  resetInferenceStream,
  streamFrameDelta,
} from "@/lib/inference/socket";
import type { Frame } from "@/types/inference";

describe("inference WebSocket client", () => {
  afterEach(() => {
    resetInferenceStream();
    FakeWebSocket.instances = [];
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
    });
  });

  test("resends the full window when the cursor fell out", () => {
    const frames = [frame(2), frame(3)];

    expect(streamFrameDelta(frames, frame(1), false)).toEqual({
      delta: frames,
      resync: true,
    });
  });

  test("does not report readiness before the handshake", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const first = prepareInferenceStream();
    const socket = await fakeSocket(0);
    socket.open();
    await Promise.resolve();

    let secondReady = false;
    const second = prepareInferenceStream().then(() => {
      secondReady = true;
    });
    await Promise.resolve();
    expect(secondReady).toBe(false);

    const request = JSON.parse(socket.sent.at(-1) ?? "null") as {
      sequence: number;
    };
    socket.receive({
      type: "pong",
      protocol: 1,
      sequence: request.sequence,
    });

    await Promise.all([first, second]);
    expect(secondReady).toBe(true);
  });

  test("an old connection failure cannot close its replacement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const first = client.prepare().catch((error: unknown) => error);
    const firstSocket = await fakeSocket(0);
    client.reset();

    const second = client.prepare();
    const secondSocket = await fakeSocket(1);
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.open();
    await Promise.resolve();
    const ping = JSON.parse(secondSocket.sent.at(-1) ?? "null") as {
      sequence: number;
    };
    secondSocket.receive({
      type: "pong",
      protocol: 1,
      sequence: ping.sequence,
    });

    await expect(second).resolves.toBeUndefined();
    await expect(first).resolves.toBeInstanceOf(Error);
    expect(secondSocket.readyState).toBe(FakeWebSocket.OPEN);
    client.reset();
  });

  test("reconnects the same PartySocket after a network close", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const firstConnection = client.prepare();
    const firstSocket = await fakeSocket(0);
    firstSocket.open();
    await Promise.resolve();
    respondToPing(firstSocket);
    await firstConnection;

    firstSocket.drop();
    const secondSocket = await fakeSocket(1);
    secondSocket.open();
    await Promise.resolve();
    const reconnected = client.prepare();
    await Promise.resolve();
    respondToPing(secondSocket);

    await expect(reconnected).resolves.toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.reset();
  });
});

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  send(data: string) {
    this.sent.push(data);
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

async function fakeSocket(index: number) {
  while (!FakeWebSocket.instances[index]) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return FakeWebSocket.instances[index];
}

function respondToPing(socket: FakeWebSocket) {
  const request = JSON.parse(socket.sent.at(-1) ?? "null") as {
    sequence: number;
  };
  socket.receive({
    type: "pong",
    protocol: 1,
    sequence: request.sequence,
  });
}

function frame(value: number): Frame {
  return Array(162).fill(value) as Frame;
}
