import { describe, it, expect } from "vitest";
import { fmtMoney, fmtPct, fmtTipMoney } from "./format";

describe("fmtMoney", () => {
  it("formats whole dollars with grouping", () => {
    expect(fmtMoney(1234)).toBe("$1,234");
    expect(fmtMoney(0)).toBe("$0");
  });
  it("rounds to the requested digits", () => {
    expect(fmtMoney(1234.56, 2)).toBe("$1,234.56");
    expect(fmtMoney(1234.56)).toBe("$1,235");
  });
  it("renders an em dash for null / non-finite", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined)).toBe("—");
    expect(fmtMoney(NaN)).toBe("—");
    expect(fmtMoney(Infinity)).toBe("—");
  });
});

describe("fmtPct", () => {
  it("scales a fraction to a percent", () => {
    expect(fmtPct(0.05)).toBe("5.0%");
    expect(fmtPct(0.1234, 2)).toBe("12.34%");
  });
  it("renders an em dash for null / non-finite", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(NaN)).toBe("—");
  });
});

describe("fmtTipMoney", () => {
  it("matches fmtMoney for finite values", () => {
    expect(fmtTipMoney(1000)).toBe(fmtMoney(1000));
  });
});
