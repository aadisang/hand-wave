import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "traces",
);

type TraceExport = {
  schemaVersion: number;
  recordings?: TraceRecording[];
  traces?: TraceEvent[];
};

type TraceEvent =
  | { type: "decode" | "finalize"; at: string }
  | {
      type: "predict";
      at: string;
      frames: number;
      latencyMs: number;
      prediction: {
        prediction: { label: string; confidence: number };
        alternatives: Array<{ label: string; confidence: number }>;
      };
    };

type TraceRecording = {
  label: string;
  frames: TraceFrame[];
};

type TraceFrame = {
  index?: number;
  inferenceMs?: number;
  captureKind?: "camera" | "screen";
  selectedHand?: "Left" | "Right" | null;
  rawFrame?: unknown;
  modelFrame?: unknown | null;
  features: number[] | null;
};

function fixturePaths() {
  if (!existsSync(fixturesDir)) return [];
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(fixturesDir, name))
    .sort();
}

function readFixture(path: string): TraceExport {
  return JSON.parse(readFileSync(path, "utf8")) as TraceExport;
}

describe("MediaPipe trace fixtures", () => {
  const paths = fixturePaths();

  if (paths.length === 0) {
    test("has a fixture directory ready for captured traces", () => {
      expect(existsSync(fixturesDir)).toBe(true);
    });
  }

  for (const path of paths) {
    test(`${basename(path)} has replayable frame data`, () => {
      const fixture = readFixture(path);

      expect(fixture.schemaVersion).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(fixture.recordings)).toBe(true);
      expect(Array.isArray(fixture.traces ?? [])).toBe(true);

      for (const trace of fixture.traces ?? []) {
        expect(typeof trace.at).toBe("string");
        if (trace.type === "predict") {
          expect(trace.frames).toBeGreaterThan(0);
          expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
          expect(typeof trace.prediction.prediction.label).toBe("string");
          expect(Array.isArray(trace.prediction.alternatives)).toBe(true);
        }
      }

      for (const recording of fixture.recordings ?? []) {
        expect(recording.label.trim().length).toBeGreaterThan(0);
        expect(recording.frames.length).toBeGreaterThan(0);

        for (const frame of recording.frames) {
          if ("index" in frame) expect(typeof frame.index).toBe("number");
          if ("inferenceMs" in frame) {
            expect(typeof frame.inferenceMs).toBe("number");
          }
          if ("captureKind" in frame) {
            expect(["camera", "screen"]).toContain(frame.captureKind);
          }
          if ("selectedHand" in frame) {
            expect(["Left", "Right", null]).toContain(frame.selectedHand);
          }
          if ("rawFrame" in frame) expect(frame.rawFrame).toBeTruthy();
          if (frame.features) {
            expect(frame.features).toHaveLength(162);
          }
        }
      }
    });
  }
});
