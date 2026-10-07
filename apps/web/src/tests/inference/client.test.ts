import { afterEach, describe, expect, test, vi } from "vitest";
import { InferenceSocket } from "@/lib/inference/socket";
import type { Frame, RecognizeIn } from "@/types/inference";

describe("inference WebSocket client", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  test("an old connection failure cannot close its replacement", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();

    const first = client.prepare().catch((error: unknown) => error);
    const firstSocket = await fakeSocket(0);
    client.close();

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
    client.close();
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
    client.close();
  });

  test("resets server state before a full-window cursor resync", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new InferenceSocket();
    const firstFrames = [frame(0), frame(1)];

    const first = client.recognize(recognizePayload(firstFrames), 1_000);
    const socket = await fakeSocket(0);
    socket.open();
    await Promise.resolve();
    respondToPing(socket);
    await respondToRecognition(socket);
    await first;

    const secondFrames = [frame(2), frame(3)];
    const second = client.recognize(recognizePayload(secondFrames), 1_000);
    await vi.waitFor(() => {
      expect(lastRequest(socket).type).toBe("reset");
    });
    const reset = lastRequest(socket);
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
  const request = lastRequest(socket);
  socket.receive({
    type: "pong",
    protocol: 1,
    sequence: request.sequence,
  });
}

async function respondToRecognition(socket: FakeWebSocket) {
  await vi.waitFor(() => {
    expect(lastRequest(socket).type).toBe("recognize");
  });
  const request = lastRequest(socket);
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

function lastRequest(socket: FakeWebSocket) {
  return JSON.parse(socket.sent.at(-1) ?? "null") as {
    sequence: number;
    type: string;
  };
}

function recognizePayload(frames: Frame[]): RecognizeIn {
  return {
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
