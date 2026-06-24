import { describe, it, expect } from "vitest";
import { median, percentile, niceStep, percentileAt } from "./math";

describe("median", () => {
  it("returns the middle of an odd-length sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middle values for even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });
});

describe("percentile", () => {
  const xs = [1, 2, 3, 4, 5];
  it("uses nearest-rank on the sorted sample", () => {
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 25)).toBe(2);
  });
  it("clamps to the endpoints", () => {
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(5);
    expect(percentile(xs, 200)).toBe(5);
  });
  it("returns 0 for an empty list", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("niceStep", () => {
  it("rounds up to a 1/2/2.5/5 × 10ⁿ value", () => {
    expect(niceStep(437000)).toBe(500000);
    expect(niceStep(250000)).toBe(250000);
    expect(niceStep(6)).toBe(10);
    expect(niceStep(2.5)).toBe(2.5);
    expect(niceStep(1)).toBe(1);
  });
  it("guards non-positive input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });
});

describe("percentileAt", () => {
  const fan = { p5: [0], p25: [100], p50: [200], p75: [300], p95: [400] };
  it("flags values below the 5th and above the 95th", () => {
    expect(percentileAt(fan, 0, -10)).toBe("below 5th percentile");
    expect(percentileAt(fan, 0, 500)).toBe("above 95th percentile");
  });
  it("interpolates between adjacent percentile curves", () => {
    expect(percentileAt(fan, 0, 150)).toBe("≈ 38th percentile");
    expect(percentileAt(fan, 0, 100)).toBe("≈ 25th percentile");
  });
});
