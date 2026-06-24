import { describe, it, expect } from "vitest";
import type { Scenario } from "./types";
import { validateScenario, hasErrors } from "./validate";

// A minimal but internally-consistent scenario. validateScenario only reads the
// fields below, so we build just those and cast — keeping each test focused on
// the one field it perturbs. base() is clean (zero issues); tests clone + break.
function base(): Scenario {
  return {
    profile: { birth_year: 2000, horizon_age: 90 },
    sim: { start_year: 2026, n_paths: 2000, success_threshold: 0.9 },
    retirement_age: 45,
    allocation: { stocks: 0.6, bonds: 0.3, cash: 0.1 },
    allocation_schedule: [],
    waterfall_schedule: [],
    events: [],
    withdrawal_policy: { mode: "priority" },
    conversion_rule: { kind: "none" },
    social_security: { claiming_age: 67, haircut: 0.75 },
    income: { gross_salary: 110000 },
    accounts: [],
    income_streams: [],
    expense_streams: [],
    medical_streams: [],
  } as unknown as Scenario;
}

const clone = (s: Scenario): Scenario => structuredClone(s);
const fields = (s: Scenario) => validateScenario(s).map((i) => i.field);

describe("validateScenario", () => {
  it("passes a well-formed scenario", () => {
    expect(validateScenario(base())).toEqual([]);
  });

  it("flags an allocation that does not sum to 100%", () => {
    const s = clone(base());
    s.allocation = { stocks: 0.6, bonds: 0.3, cash: 0.2 };
    const issues = validateScenario(s);
    expect(hasErrors(issues)).toBe(true);
    expect(fields(s)).toContain("allocation");
  });

  it("flags a negative allocation component", () => {
    const s = clone(base());
    s.allocation = { stocks: 1.1, bonds: -0.1, cash: 0 };
    expect(fields(s)).toContain("allocation.bonds");
  });

  it("errors when retirement is past the horizon", () => {
    const s = clone(base());
    s.retirement_age = 95;
    const issues = validateScenario(s);
    expect(hasErrors(issues)).toBe(true);
    expect(fields(s)).toContain("retirement_age");
  });

  it("errors when the horizon is at or before the current age", () => {
    const s = clone(base());
    s.profile.horizon_age = 20; // start age is 26
    expect(fields(s)).toContain("profile.horizon_age");
  });

  it("warns when retiring before the current age", () => {
    const s = clone(base());
    s.retirement_age = 20;
    const issues = validateScenario(s);
    expect(issues.some((i) => i.field === "retirement_age" && i.level === "warning")).toBe(true);
  });

  it("warns on a non-ascending glidepath", () => {
    const s = clone(base());
    s.allocation_schedule = [
      { start_age: 50, allocation: { stocks: 0.5, bonds: 0.4, cash: 0.1 } },
      { start_age: 40, allocation: { stocks: 0.4, bonds: 0.5, cash: 0.1 } },
    ];
    expect(fields(s)).toContain("allocation_schedule");
  });

  it("errors on a custom bracket ceiling with no amount", () => {
    const s = clone(base());
    s.conversion_rule = { kind: "fill_bracket", bracket_top: "custom" } as Scenario["conversion_rule"];
    const issues = validateScenario(s);
    expect(hasErrors(issues)).toBe(true);
    expect(fields(s)).toContain("conversion_rule.custom_top");
  });

  it("warns on a claiming age outside 62–70", () => {
    const s = clone(base());
    s.social_security.claiming_age = 75;
    expect(fields(s)).toContain("social_security.claiming_age");
  });

  it("errors on a non-positive path count", () => {
    const s = clone(base());
    s.sim.n_paths = 0;
    expect(hasErrors(validateScenario(s))).toBe(true);
  });

  it("warns on an expense stream that ends before it starts", () => {
    const s = clone(base());
    s.expense_streams = [
      { name: "Travel", annual: 5000, start_age: 60, end_age: 50 } as Scenario["expense_streams"][number],
    ];
    expect(fields(s)).toContain("expense_streams[Travel]");
  });
});
