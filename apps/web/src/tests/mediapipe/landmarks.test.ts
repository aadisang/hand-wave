import { describe, expect, it } from "vitest";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandLandmarksFrame } from "@/hooks/use-hand-landmarker";
import { toInferenceFrame } from "@/lib/mediapipe/landmarks";

describe("toInferenceFrame", () => {
  it("keeps a valid hand and upper-body pose even when visibility metadata is low", () => {
    const frame = handFrame({
      rightHandLandmarks: [landmarks(21, point(0.5, 0.5, 0.1))],
      leftHandLandmarks: [],
      poseLandmarks: [pose()],
    });

    expect(toInferenceFrame(frame)).toHaveLength((21 + 33) * 3);
  });

  it("rejects frames without both a hand and pose", () => {
    expect(
      toInferenceFrame(
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
      toInferenceFrame(
        handFrame({
          rightHandLandmarks: [landmarks(21, point(0.5, 0.5))],
          leftHandLandmarks: [],
          poseLandmarks: [outOfFramePose],
        }),
      ),
    ).toBeNull();
  });
});

function handFrame(frame: HandLandmarksFrame) {
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

function point(x: number, y: number, z = 0, visibility = 1) {
  return { x, y, z, visibility };
}
