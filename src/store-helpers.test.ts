import { describe, it, expect } from "vitest";
import type { Scenario } from "./types";
import { normalizeScenario, sweepKey } from "./store";

// normalizeScenario enforces the "every expense stream inflates at base CPI"
// invariant (the per-stream inflation control was removed from the UI); medical
// streams keep their own CPI+ control and must be left untouched.
describe("normalizeScenario", () => {
  // `housing` is present so the backfill in normalizeScenario is a no-op here —
  // these cases exercise only the expense-stream invariant.
  const withStreams = (expense_streams: unknown[], medical_streams: unknown[] = []) =>
    ({ expense_streams, medical_streams, housing: { enabled: false } } as unknown as Scenario);

  it("forces inflates=true and zeroes extra_inflation on expense streams", () => {
    const s = withStreams([{ name: "Rent", annual: 20000, inflates: false, extra_inflation: 0.02 }]);
    const out = normalizeScenario(s);
    expect(out.expense_streams[0].inflates).toBe(true);
    expect(out.expense_streams[0].extra_inflation).toBe(0);
  });

  it("returns the same reference when nothing needs changing", () => {
    const s = withStreams([{ name: "Rent", annual: 20000, inflates: true, extra_inflation: 0 }]);
    expect(normalizeScenario(s)).toBe(s);
  });

  it("does not touch medical streams", () => {
    const s = withStreams(
      [{ name: "Rent", annual: 20000, inflates: false, extra_inflation: 0 }],
      [{ name: "Dental", annual: 1500, inflates: true, extra_inflation: 0.015 }],
    );
    const out = normalizeScenario(s);
    expect(out.medical_streams[0].extra_inflation).toBe(0.015);
  });
});

// The success-curve sweep depends on the whole scenario EXCEPT the planned
// retirement age (which only moves the selected point along the curve).
describe("sweepKey", () => {
  it("is invariant to the retirement age", () => {
    const a = { name: "X", retirement_age: 45, allocation: { stocks: 0.6 } } as unknown as Scenario;
    const b = { name: "X", retirement_age: 60, allocation: { stocks: 0.6 } } as unknown as Scenario;
    expect(sweepKey(a)).toBe(sweepKey(b));
  });

  it("changes when any other field changes", () => {
    const a = { name: "X", retirement_age: 45, allocation: { stocks: 0.6 } } as unknown as Scenario;
    const b = { name: "X", retirement_age: 45, allocation: { stocks: 0.7 } } as unknown as Scenario;
    expect(sweepKey(a)).not.toBe(sweepKey(b));
  });
});
