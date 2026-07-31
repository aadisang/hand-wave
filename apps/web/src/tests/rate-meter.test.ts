import { describe, expect, it } from "vitest";
import { createRateMeter } from "@/lib/rate-meter";

describe("createRateMeter", () => {
  it("measures events over elapsed time", () => {
    const meter = createRateMeter(500);

    expect(meter.push(0)).toBeNull();
    for (let frame = 1; frame < 30; frame += 1) {
      expect(meter.push((frame * 1_000) / 60)).toBeNull();
    }

    expect(meter.push(500)).toBeCloseTo(60);
  });

  it("counts frames skipped between observations", () => {
    const meter = createRateMeter(500);

    expect(meter.push(0)).toBeNull();
    expect(meter.push(250, 15)).toBeNull();
    expect(meter.push(500, 15)).toBeCloseTo(60);
  });

  it("resets the measurement window", () => {
    const meter = createRateMeter(500);

    meter.push(0);
    meter.push(500, 30);
    meter.reset();

    expect(meter.push(1_000)).toBeNull();
    expect(meter.push(1_500, 15)).toBeCloseTo(30);
  });
});
