import { describe, it, expect } from "vitest";
import { monthlyPayment, amortize, rentVsBuy, housingDerived } from "./housing";

describe("monthlyPayment", () => {
  it("matches the closed-form mortgage formula", () => {
    // $300k, 6%, 30yr -> ~$1,798.65/mo
    expect(monthlyPayment(300000, 0.06, 30)).toBeCloseTo(1798.65, 1);
  });
  it("is principal / months at a zero rate", () => {
    expect(monthlyPayment(360000, 0, 30)).toBeCloseTo(1000, 6);
  });
  it("is zero for a non-positive principal or term", () => {
    expect(monthlyPayment(0, 0.06, 30)).toBe(0);
    expect(monthlyPayment(300000, 0.06, 0)).toBe(0);
  });
});

describe("amortize", () => {
  it("pays the loan off exactly at term", () => {
    const r = amortize({ price: 400000, downPct: 0.2, rate: 0.065, termYears: 30 });
    expect(r.loan).toBeCloseTo(320000, 6);
    expect(r.schedule[r.schedule.length - 1].balance).toBeCloseTo(0, 2);
    expect(r.payoffYear).toBe(30);
  });
  it("charges more total interest on a 30yr than a 15yr", () => {
    const base = { price: 400000, downPct: 0.2, rate: 0.065 };
    const y30 = amortize({ ...base, termYears: 30 });
    const y15 = amortize({ ...base, termYears: 15 });
    expect(y30.totalInterest).toBeGreaterThan(y15.totalInterest);
  });
  it("balance is monotonically non-increasing", () => {
    const r = amortize({ price: 350000, downPct: 0.2, rate: 0.06, termYears: 30 });
    for (let i = 1; i < r.schedule.length; i++) {
      expect(r.schedule[i].balance).toBeLessThanOrEqual(r.schedule[i - 1].balance + 1e-6);
    }
  });
  it("an ARM reset to a higher rate raises later interest", () => {
    const base = { price: 400000, downPct: 0.2, rate: 0.05, termYears: 30 } as const;
    const fixed = amortize({ ...base });
    const arm = amortize({ ...base, type: "arm", armFixedYears: 5, armResetRate: 0.09 });
    // post-reset, the ARM owes more (higher rate slows paydown)
    expect(arm.schedule[10].balance).toBeGreaterThan(fixed.schedule[10].balance);
  });
});

describe("rentVsBuy", () => {
  const base = {
    price: 350000, downPct: 0.2, closingPct: 0.03, rate: 0.065, termYears: 30,
    propertyTaxRate: 0.017, insuranceAnnual: 1673, maintenancePct: 0.01,
    inflation: 0.025, sellingCostsPct: 0.06, monthlyRent: 1500, years: 30,
  };

  it("returns aligned wealth arrays over the horizon", () => {
    const r = rentVsBuy({ ...base, appreciationReal: 0.0, investReturnReal: 0.05 });
    expect(r.buyWealthReal).toHaveLength(31);
    expect(r.rentWealthReal).toHaveLength(31);
  });

  it("strong appreciation + weak markets favors buying (earlier break-even)", () => {
    const buyFriendly = rentVsBuy({ ...base, appreciationReal: 0.03, investReturnReal: 0.0 });
    const rentFriendly = rentVsBuy({ ...base, appreciationReal: 0.0, investReturnReal: 0.07 });
    const be = (x: number | null) => (x === null ? Infinity : x);
    expect(be(buyFriendly.breakEvenYear)).toBeLessThan(be(rentFriendly.breakEvenYear));
  });

  it("a flat home with strong markets can leave renting ahead at the horizon", () => {
    const r = rentVsBuy({ ...base, appreciationReal: 0.0, investReturnReal: 0.07 });
    expect(r.rentWealthReal[30]).toBeGreaterThan(r.buyWealthReal[30]);
  });
});

describe("housingDerived", () => {
  const cfg = {
    enabled: true, purchase_age: 30, home_price: 350000, down_payment_pct: 0.2,
    mortgage_rate: 0.065, loan_term_years: 30, loan_type: "fixed" as const,
    arm_fixed_years: 5, arm_reset_rate: 0.075, points: 0,
    property_tax_rate: 0.017, insurance_annual: 1673, maintenance_pct: 0.01,
    pmi_rate: 0.0075, sale_age: null as number | null,
  };

  it("returns null when housing is disabled", () => {
    expect(housingDerived({ ...cfg, enabled: false }, 26, 90)).toBeNull();
  });

  it("derives the mortgage in today's dollars", () => {
    const d = housingDerived(cfg, 26, 90)!;
    expect(d.mortgage.loanToday).toBeCloseTo(280000, 6); // 80% of 350k
    expect(d.mortgage.startAge).toBe(30);
    expect(d.mortgage.payoffAge).toBe(60); // 30yr term
    expect(d.mortgage.annualPaymentToday).toBeGreaterThan(0);
  });

  it("derives carrying-cost streams (no PMI at 20% down)", () => {
    const names = housingDerived(cfg, 26, 90)!.expenses.map((e) => e.name);
    expect(names).toEqual(["Property Tax", "Home Insurance", "Home Maintenance"]);
  });

  it("adds PMI below 20% down", () => {
    const names = housingDerived({ ...cfg, down_payment_pct: 0.1 }, 26, 90)!.expenses.map((e) => e.name);
    expect(names).toContain("PMI");
  });

  it("derives a Buy event, plus Sell when a sale is set", () => {
    expect(housingDerived(cfg, 26, 90)!.events.map((e) => e.name)).toEqual(["Buy Home"]);
    const withSale = housingDerived({ ...cfg, sale_age: 55 }, 26, 90)!;
    expect(withSale.events.map((e) => e.name)).toEqual(["Buy Home", "Sell Home"]);
  });
});
