import { describe, it, expect } from "vitest";
import {
  adjustTarget,
  targetEndMs,
  targetReached,
  formatDuration,
  MIN_TARGET_MIN,
} from "../src/timer";

describe("timer utils", () => {
  it("computes the target end timestamp", () => {
    expect(targetEndMs(1000, 25)).toBe(1000 + 25 * 60_000);
  });

  it("reaches target at exactly targetMin and beyond", () => {
    expect(targetReached(0, 25, 24 * 60_000)).toBe(false);
    expect(targetReached(0, 25, 25 * 60_000)).toBe(true);
    expect(targetReached(0, 25, 30 * 60_000)).toBe(true);
  });

  it("clamps target adjustments to the minimum", () => {
    expect(adjustTarget(25, 5)).toBe(30);
    expect(adjustTarget(25, -10)).toBe(15);
    expect(adjustTarget(10, -10)).toBe(MIN_TARGET_MIN);
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
});
