// Scenario input validation — catches nonsensical inputs that would otherwise
// produce plausible-looking but wrong projections (garbage in → garbage out).
//
// Pure and UI-agnostic: validateScenario() returns a flat list of issues that
// the app surfaces as a dismissible banner. Issues are advisory by design —
// `error` means the result is almost certainly meaningless (a number the engine
// can't sensibly use); `warning` means "this is probably a mistake, but the run
// is still well-defined." Nothing here blocks a run; this is a personal tool and
// the point is to flag, not to forbid experimentation.

import type {
  Allocation, AllocationSegment, ConversionRule, ExpenseStream, IncomeStream,
  Scenario, WaterfallSegment, WithdrawalPolicy,
} from "./types";

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  /** Dotted path to the offending field, for the reader to locate it. */
  field: string;
  message: string;
}

const ALLOCATION_EPS = 1e-4;
const MIN_CLAIM_AGE = 62;
const MAX_CLAIM_AGE = 70;

/** stocks + bonds + cash must sum to 1 and none may be negative. */
function checkAllocation(a: Allocation | null | undefined, field: string,
                        out: ValidationIssue[]): void {
  if (!a) return;
  const parts = [["stocks", a.stocks], ["bonds", a.bonds], ["cash", a.cash]] as const;
  for (const [name, v] of parts) {
    if (v < 0) out.push({ level: "error", field: `${field}.${name}`,
      message: `Allocation to ${name} is negative (${v}).` });
  }
  const sum = a.stocks + a.bonds + a.cash;
  if (Math.abs(sum - 1) > ALLOCATION_EPS) {
    out.push({ level: "error", field,
      message: `Allocation must sum to 100% — stocks + bonds + cash = ${(sum * 100).toFixed(1)}%.` });
  }
}

/** Age-keyed schedules must have strictly ascending, non-negative start ages. */
function checkAscendingAges(ages: number[], field: string, out: ValidationIssue[]): void {
  for (let i = 1; i < ages.length; i++) {
    if (ages[i] <= ages[i - 1]) {
      out.push({ level: "warning", field,
        message: `Ages must increase down the schedule — ${ages[i]} follows ${ages[i - 1]}.` });
      break;
    }
  }
}

/** A "custom" bracket ceiling needs a positive dollar value to mean anything. */
function checkCustomBracket(top: string | undefined, custom: number | undefined,
                          field: string, out: ValidationIssue[]): void {
  if (top === "custom" && !(typeof custom === "number" && custom > 0)) {
    out.push({ level: "error", field: `${field}.custom_top`,
      message: `Bracket ceiling is set to "custom" but no positive dollar amount is given.` });
  }
}

function checkStreamWindow(s: IncomeStream | ExpenseStream, kind: string,
                          out: ValidationIssue[]): void {
  if (s.start_age != null && s.end_age != null && s.end_age < s.start_age) {
    out.push({ level: "warning", field: `${kind}[${s.name}]`,
      message: `Ends (age ${s.end_age}) before it starts (age ${s.start_age}).` });
  }
  if (s.annual < 0) {
    out.push({ level: "warning", field: `${kind}[${s.name}].annual`,
      message: `Negative annual amount (${s.annual}).` });
  }
}

/** Validate a scenario, returning every issue found (empty = clean). */
export function validateScenario(s: Scenario): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const startAge = s.sim.start_year - s.profile.birth_year;

  // --- Age timeline: current age < retirement < horizon -------------------
  if (startAge < 0 || startAge > 120) {
    out.push({ level: "error", field: "profile.birth_year",
      message: `Birth year ${s.profile.birth_year} implies an age of ${startAge} at the ${s.sim.start_year} start.` });
  }
  if (s.profile.horizon_age <= startAge) {
    out.push({ level: "error", field: "profile.horizon_age",
      message: `Horizon age (${s.profile.horizon_age}) is at or before your current age (${startAge}) — no years to simulate.` });
  }
  if (s.retirement_age > s.profile.horizon_age) {
    out.push({ level: "error", field: "retirement_age",
      message: `Retirement age (${s.retirement_age}) is past the horizon (${s.profile.horizon_age}).` });
  }
  if (s.retirement_age < startAge) {
    out.push({ level: "warning", field: "retirement_age",
      message: `Retirement age (${s.retirement_age}) is before your current age (${startAge}) — modeling someone already retired.` });
  }

  // --- Allocation (base, glidepath, event overrides) ----------------------
  checkAllocation(s.allocation, "allocation", out);
  (s.allocation_schedule ?? []).forEach((seg: AllocationSegment, i) =>
    checkAllocation(seg.allocation, `allocation_schedule[${i}].allocation`, out));
  checkAscendingAges((s.allocation_schedule ?? []).map((seg) => seg.start_age),
    "allocation_schedule", out);
  (s.waterfall_schedule ?? []).forEach((seg: WaterfallSegment, i) => {
    if (seg.start_age < startAge)
      out.push({ level: "warning", field: `waterfall_schedule[${i}].start_age`,
        message: `Starts at age ${seg.start_age}, before your current age (${startAge}).` });
  });
  checkAscendingAges((s.waterfall_schedule ?? []).map((seg) => seg.start_age),
    "waterfall_schedule", out);
  for (const ev of s.events) {
    if (ev.overrides?.allocation)
      checkAllocation(ev.overrides.allocation, `events[${ev.name}].overrides.allocation`, out);
  }

  // --- Bracket ceilings ---------------------------------------------------
  const wp: WithdrawalPolicy = s.withdrawal_policy;
  if (wp.mode === "bracket_filled") checkCustomBracket(wp.bracket_top, wp.custom_top, "withdrawal_policy", out);
  const cr: ConversionRule = s.conversion_rule;
  if (cr.kind === "fill_bracket") checkCustomBracket(cr.bracket_top, cr.custom_top, "conversion_rule", out);

  // --- Social Security ----------------------------------------------------
  const ss = s.social_security;
  if (ss.claiming_age < MIN_CLAIM_AGE || ss.claiming_age > MAX_CLAIM_AGE) {
    out.push({ level: "warning", field: "social_security.claiming_age",
      message: `Claiming age (${ss.claiming_age}) is outside the legal 62–70 window.` });
  }
  if (ss.haircut <= 0 || ss.haircut > 1) {
    out.push({ level: "warning", field: "social_security.haircut",
      message: `Benefit haircut (${ss.haircut}) should be a fraction in (0, 1].` });
  }

  // --- Sim settings -------------------------------------------------------
  if (s.sim.n_paths < 1) {
    out.push({ level: "error", field: "sim.n_paths",
      message: `Path count (${s.sim.n_paths}) must be at least 1.` });
  }
  if (s.sim.success_threshold <= 0 || s.sim.success_threshold > 1) {
    out.push({ level: "warning", field: "sim.success_threshold",
      message: `Success threshold (${s.sim.success_threshold}) should be a fraction in (0, 1].` });
  }

  // --- Money sanity -------------------------------------------------------
  if (s.income.gross_salary < 0) {
    out.push({ level: "error", field: "income.gross_salary",
      message: `Gross salary is negative (${s.income.gross_salary}).` });
  }
  s.accounts.forEach((a, i) => {
    if (a.balance < 0)
      out.push({ level: "warning", field: `accounts[${i}].balance`,
        message: `${a.type} balance is negative (${a.balance}).` });
  });
  s.income_streams.forEach((st) => checkStreamWindow(st, "income_streams", out));
  s.expense_streams.forEach((st) => checkStreamWindow(st, "expense_streams", out));
  s.medical_streams.forEach((st) => checkStreamWindow(st, "medical_streams", out));

  // --- Housing ------------------------------------------------------------
  const h = s.housing;
  if (h?.enabled) {
    if (h.loan_term_years < 1) {
      out.push({ level: "error", field: "housing.loan_term_years",
        message: `Loan term (${h.loan_term_years}) must be at least 1 year.` });
    }
    if (h.down_payment_pct < 0 || h.down_payment_pct > 1) {
      out.push({ level: "error", field: "housing.down_payment_pct",
        message: `Down payment (${(h.down_payment_pct * 100).toFixed(0)}%) must be between 0 and 100%.` });
    }
    if (h.home_price < 0) {
      out.push({ level: "warning", field: "housing.home_price",
        message: `Home price is negative (${h.home_price}).` });
    }
    if (h.purchase_age < startAge) {
      out.push({ level: "warning", field: "housing.purchase_age",
        message: `Purchase age (${h.purchase_age}) is before your current age (${startAge}); v1 models a fresh purchase from today onward.` });
    }
    if (h.sale_age != null && h.sale_age <= h.purchase_age) {
      out.push({ level: "warning", field: "housing.sale_age",
        message: `Sale age (${h.sale_age}) is at or before the purchase age (${h.purchase_age}).` });
    }
    // Double-count guard: the Housing config already generates the mortgage and
    // the property-tax / insurance / maintenance costs. Flag manual rows that
    // duplicate them so the two don't stack.
    const mortgageRe = /mortgage|home\s*loan|house\s*loan/i;
    const homeCostRe = /property\s*tax|home\s*insurance|home\s*maintenance|homeowners?\s*insurance/i;
    (s.liabilities ?? []).forEach((l) => {
      if (mortgageRe.test(l.name))
        out.push({ level: "warning", field: `liabilities[${l.name}]`,
          message: `"${l.name}" looks like a mortgage, but Housing already models one — remove it to avoid double-counting.` });
    });
    s.expense_streams.forEach((e) => {
      if (homeCostRe.test(e.name))
        out.push({ level: "warning", field: `expense_streams[${e.name}]`,
          message: `"${e.name}" duplicates a cost Housing already adds — remove it or it will double-count.` });
    });
    const buyEventRe = /down\s*payment|home\s*purchase|house\s*purchase|buy(ing)?\s*(a\s*)?(house|home)/i;
    s.events.forEach((e) => {
      if (buyEventRe.test(e.name))
        out.push({ level: "warning", field: `events[${e.name}]`,
          message: `"${e.name}" looks like a home purchase, but Housing already models the down payment — remove this event to avoid double-counting.` });
    });
  }

  return out;
}

/** True if any issue is an error (the result should not be trusted at all). */
export const hasErrors = (issues: ValidationIssue[]): boolean =>
  issues.some((i) => i.level === "error");
