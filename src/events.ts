// Display-level event kinds. The engine schema keeps three compact kinds
// (one_time_flow with a sign, regime_change with overrides, crash); the UI
// presents five explicit ones so nobody has to remember sign conventions.

import type { FireEvent, Scenario } from "./types";

export type DisplayKind =
  | "expense" | "recurring" | "income" | "salary" | "allocation" | "crash";

export const KIND_META: Record<DisplayKind, { label: string; color: string }> = {
  expense: { label: "One-Time Expense", color: "#f0883e" },
  recurring: { label: "Recurring Expense", color: "#db6d28" },
  income: { label: "One-Time Income", color: "#3fb950" },
  salary: { label: "New Salary", color: "#58a6ff" },
  allocation: { label: "Change Allocation", color: "#bc8cff" },
  crash: { label: "Market Crash", color: "#ff7b72" },
};

export const KIND_ORDER: DisplayKind[] = [
  "expense", "recurring", "income", "salary", "allocation", "crash",
];

export function displayKindOf(ev: FireEvent): DisplayKind {
  if (ev.kind === "crash") return "crash";
  if (ev.kind === "recurring_flow") return "recurring";
  if (ev.kind === "one_time_flow") return ev.amount < 0 ? "income" : "expense";
  // regime_change: allocation-only overrides count as an allocation event
  const ov = ev.overrides ?? {};
  if (ov.allocation != null && ov.gross_salary == null && ov.salary_real_growth == null) {
    return "allocation";
  }
  return "salary";
}

export function newEventOf(kind: DisplayKind, age: number, scenario: Scenario): FireEvent {
  switch (kind) {
    case "expense":
      return { kind: "one_time_flow", name: "Expense", age, amount: 20000 };
    case "recurring":
      return {
        kind: "recurring_flow", name: "Recurring Expense", age, amount: 2000,
        interval_years: 3, end_age: scenario.profile.horizon_age,
      };
    case "income":
      return { kind: "one_time_flow", name: "Windfall", age, amount: -20000 };
    case "crash":
      return { kind: "crash", name: "Crash", age, amount: 0, stock_return: -0.35 };
    case "allocation":
      return {
        kind: "regime_change", name: "Rebalance", age, amount: 0,
        overrides: {
          allocation: { ...scenario.allocation },
        },
      };
    case "salary":
    default:
      return {
        kind: "regime_change", name: "New Salary", age, amount: 0,
        overrides: {
          gross_salary: Math.max(scenario.income.gross_salary, 1000),
          salary_real_growth: scenario.income.real_growth,
        },
      };
  }
}
