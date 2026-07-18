import { describe, expect, test } from "vitest";
import {
  inferenceWebSocketURL,
  streamFrameDelta,
} from "@/lib/inference/client";
import type { Frame } from "@/types/inference";

describe("inference WebSocket client", () => {
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
});

function frame(value: number): Frame {
  return Array(162).fill(value) as Frame;
}
