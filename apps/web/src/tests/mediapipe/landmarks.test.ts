import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  createActiveHandSelector,
  toFrame,
  toModelInput,
} from "@/lib/mediapipe/landmarks";
import type { HandFrame } from "@/types/landmarks";

describe("toFrame", () => {
  it("keeps a valid hand and upper-body pose even when visibility metadata is low", () => {
    const frame = handFrame({
      rightHandLandmarks: [landmarks(21, point(0.5, 0.5, 0.1))],
      leftHandLandmarks: [],
      poseLandmarks: [pose()],
    });

    expect(toFrame(frame)).toHaveLength((21 + 33) * 3);
  });

  it("rejects frames without both a hand and pose", () => {
    expect(
      toFrame(
        handFrame({
          rightHandLandmarks: [landmarks(21, point(0.5, 0.5))],
          leftHandLandmarks: [],
          poseLandmarks: [],
        }),
      ),
    ).toBeNull();
  });

  it("rejects poses whose upper-body anchors are out of frame", () => {
    const outOfFramePose = pose();
    outOfFramePose[11] = point(2, 2);

    expect(
      toFrame(
        handFrame({
          rightHandLandmarks: [landmarks(21, point(0.5, 0.5))],
          leftHandLandmarks: [],
          poseLandmarks: [outOfFramePose],
        }),
      ),
    ).toBeNull();
  });
});

describe("toModelInput", () => {
  it("packs left hands in canonical model space but draws the source hand", () => {
    const rawLeft = landmarks(21, point(0.2, 0.5, 0.1));
    const frame = handFrame({
      rightHandLandmarks: [],
      leftHandLandmarks: [rawLeft],
      poseLandmarks: [pose()],
    });

    const input = toModelInput(frame);

    expect(input?.features).toHaveLength((21 + 33) * 3);
    expect(input?.features[0]).toBeCloseTo(0.8);
    expect(input?.frame.rightHandLandmarks).toEqual([]);
    expect(input?.frame.leftHandLandmarks[0]?.[0]?.x).toBeCloseTo(0.2);
    expect(input?.frame.poseLandmarks[0]?.[0]?.x).toBeCloseTo(0.5);
  });

  it("draws neither hand nor pose when nothing would be sent", () => {
    const input = toModelInput(
      handFrame({
        rightHandLandmarks: [landmarks(21, point(0.5, 0.5))],
        leftHandLandmarks: [],
        poseLandmarks: [],
      }),
    );

    expect(input).toBeNull();
  });
});

describe("createActiveHandSelector", () => {
  it("selects the hand that appears first", () => {
    const selector = createActiveHandSelector();

    expect(
      selector.select(
        handFrame({
          rightHandLandmarks: [],
          leftHandLandmarks: [handAt(0.2, 0.4)],
          poseLandmarks: [pose()],
        }),
      ),
    ).toBe("Left");

    expect(
      selector.select(
        handFrame({
          rightHandLandmarks: [handAt(0.8, 0.4)],
          leftHandLandmarks: [handAt(0.2, 0.4)],
          poseLandmarks: [pose()],
        }),
      ),
    ).toBe("Left");
  });

  it("switches when the other hand is the one moving", () => {
    const selector = createActiveHandSelector();

    selector.select(
      handFrame({
        rightHandLandmarks: [handAt(0.8, 0.4)],
        leftHandLandmarks: [],
        poseLandmarks: [pose()],
      }),
    );
    selector.select(
      handFrame({
        rightHandLandmarks: [handAt(0.8, 0.4)],
        leftHandLandmarks: [handAt(0.2, 0.4)],
        poseLandmarks: [pose()],
      }),
    );

    expect(
      selector.select(
        handFrame({
          rightHandLandmarks: [handAt(0.8, 0.4)],
          leftHandLandmarks: [handAt(0.32, 0.4)],
          poseLandmarks: [pose()],
        }),
      ),
    ).toBe("Left");
  });
});

function handFrame(frame: HandFrame) {
  return frame;
}

function pose() {
  return Array.from({ length: 33 }, (_, index) => {
    if (index === 0) return point(0.5, 0.2, 0, 0.1);
    if (index === 11) return point(0.35, 0.45, 0, 0.1);
    if (index === 12) return point(0.65, 0.45, 0, 0.1);
    return point(0.5, 0.6, 0, 0.1);
  });
}

function landmarks(count: number, landmark: NormalizedLandmark) {
  return Array.from({ length: count }, () => ({ ...landmark }));
}

function handAt(x: number, y: number) {
  return Array.from({ length: 21 }, (_, index) => ({
    x: x + index * 0.001,
    y,
    z: 0,
    visibility: 1,
  }));
}

function point(x: number, y: number, z = 0, visibility = 1) {
  return { x, y, z, visibility };
}
