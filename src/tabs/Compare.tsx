import React, { useMemo, useState } from "react";
import { A } from "../assumptions";
import {
  CompareBridgeChart, CompareChart, CompareEndingDistChart, CompareSatisfactionChart,
  CompareSurvivalChart, CompareSweepChart, yearsToFiNum,
} from "../components/charts";
import { useShallow } from "zustand/react/shallow";
import { Section, SectionNav, fmtMoney, fmtPct } from "../components/ui";
import { median } from "../math";
import { useStore, type CompareSlot } from "../store";

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

/** The age a scenario first clears the success threshold (start age + years-to-FI),
 *  as a display string. "…" while the sweep is pending, "—" with no sweep, "> 70"
 *  if no swept age through 70 clears. */
function fiAge(slot: CompareSlot): string {
  if (slot.sweepPending) return "…";
  if (!slot.sweep) return "—";
  const yrs = yearsToFiNum(slot);
  if (yrs == null) return "> 70";
  const startAge = slot.scenario.sim.start_year - slot.scenario.profile.birth_year;
  return String(startAge + yrs);
}

/** A pinned-scenario chip: color swatch (matches its chart line), the name as a
 *  click-to-rename field, and a remove ✕. Clicking the chip toggles focus, which
 *  spotlights that scenario across every chart on the tab. */
function ScenarioChip({ slot, focused, onFocus }: {
  slot: CompareSlot; focused: boolean; onFocus: () => void;
}) {
  const { renameInCompare, removeFromCompare } = useStore(useShallow((s) => ({
    renameInCompare: s.renameInCompare, removeFromCompare: s.removeFromCompare,
  })));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot.name);
  const commit = () => { renameInCompare(slot.id, draft); setEditing(false); };
  return (
    <span className={`scenario-chip${focused ? " is-focused" : ""}`}
      title="Click to focus across all charts" onClick={() => !editing && onFocus()}
      style={focused ? { borderColor: slot.color, boxShadow: `0 0 0 1px ${slot.color} inset` } : undefined}>
      <span className="scenario-chip-dot" style={{ background: slot.color }} />
      {editing ? (
        <input autoFocus value={draft} className="scenario-chip-input"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(slot.name); setEditing(false); } }}
          onBlur={commit} />
      ) : (
        <span className="scenario-chip-name" title="Double-click to rename"
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(slot.name); setEditing(true); }}>{slot.name}</span>
      )}
      <button className="scenario-chip-x ghost" title="Remove from comparison"
        onClick={(e) => { e.stopPropagation(); removeFromCompare(slot.id); }}>✕</button>
    </span>
  );
}

const BRACKET_LABEL = (top: string, custom?: number) =>
  top === "custom" ? `Custom ${fmtMoney(custom ?? 0)}`
  : top === "std_deduction" ? "Std Deduction"
  : `${top}%`;

/** Roth-conversion strategy as a one-liner: the chosen dollar amount for a fixed
 *  ladder, the target bracket (its top marginal %) for a bracket-fill, else None. */
function rothLabel(cr: CompareSlot["scenario"]["conversion_rule"]): string {
  if (!cr || cr.kind === "none") return "None";
  if (cr.kind === "fixed") return `Fixed ${fmtMoney(cr.annual_amount)}`;
  return `Fill ${BRACKET_LABEL(cr.bracket_top, cr.custom_top)}`;
}

/** Spending strategy name + its defining parameter — guardrails on/off for a
 *  steady paycheck, the draw rate (and mode) for percent-of-portfolio. */
function spendDetailLabel(sc: CompareSlot["scenario"]): string {
  const ss = sc.spending_strategy;
  if (ss.kind === "constant_dollar") return `Guardrails ${sc.guardrails.enabled ? "On" : "Off"}`;
  return `${fmtPct(ss.rate, 1)} ${ss.rate_mode === "vpw" ? "VPW" : "Fixed"}${ss.bounded ? ", Bounded" : ""}`;
}

/** Planned non-essential (discretionary) spending active at an age, today's $.
 *  Mirrors the engine's active-stream predicate (success.annual_retirement_expenses). */
function discretionaryAt(sc: CompareSlot["scenario"], age: number): number {
  return (sc.expense_streams ?? []).reduce((a, s) =>
    a + (!s.essential
      && (s.start_age == null || s.start_age <= age)
      && (s.end_age == null || s.end_age >= age) ? s.annual : 0), 0);
}

/** Liquid withdrawal rate at retirement: early-retirement spending ÷ penalty-free
 *  (accessible) net worth at retirement. Shared by the summary table and the bridge
 *  table so both read the exact same number. */
function liquidWithdrawalRate(s: CompareSlot): number | null {
  const r = s.result, ages = r.ages ?? [];
  const idxAtAge = (age: number) => { const i = ages.findIndex((a) => a >= age); return i < 0 ? ages.length - 1 : i; };
  const retire = s.scenario.retirement_age;
  const retIdx = idxAtAge(retire);
  const retSpend = (r.expenses_median_real ?? [])[idxAtAge(retire + 2)] ?? 0;
  const accFan = r.accessibility_fan?.p50 ?? [];
  const accAtRet = accFan[retIdx + 1] ?? accFan[retIdx] ?? 0;
  return accAtRet > 0 ? retSpend / accAtRet : null;
}

/** Per-scenario summary metrics, derived from the pinned scenario + its result.
 *  Numeric fields drive the inline ranking bars; display lives in the table specs. */
function derive(s: CompareSlot) {
  const r = s.result, sc = s.scenario;
  const ages = r.ages ?? [];
  const idxAtAge = (age: number) => { const i = ages.findIndex((a) => a >= age); return i < 0 ? ages.length - 1 : i; };
  const retire = sc.retirement_age;
  const workIdx = Math.max(0, idxAtAge(retire) - 1);
  const retIdx = idxAtAge(retire);
  const retSpendIdx = idxAtAge(retire + 2);
  const exp = r.expenses_median_real ?? [];
  const tax = r.taxes_median_real ?? [];
  // Gross income as the average over the working years of the realized wage
  // ladder (salary + bonus + secondary streams, raises and life-event regime
  // changes included), not just today's base pay. Falls back to base inputs if
  // the engine didn't surface a wage series.
  const wages = r.wages_median_real ?? [];
  let wageSum = 0, wageN = 0;
  for (let i = 0; i < ages.length; i++) if (ages[i] < retire) { wageSum += wages[i] ?? 0; wageN++; }
  const baseIncome = sc.income.gross_salary + (sc.income.bonus ?? 0)
    + (sc.income_streams ?? []).reduce((a, x) => a + (x.annual ?? 0), 0);
  const income = wageN > 0 ? wageSum / wageN : baseIncome;
  const workSpend = exp[workIdx] ?? 0;
  const workTax = tax[workIdx] ?? 0;
  // Wage in the same (final working) year as the spend/tax above, so the savings
  // rate is an internally consistent snapshot rather than a mix of time points.
  const workWage = wages[workIdx] ?? baseIncome;
  const retSpend = exp[retSpendIdx] ?? 0;
  const workAge = ages[workIdx] ?? retire - 1;
  const retAge = ages[retSpendIdx] ?? retire + 2;
  const discWork = discretionaryAt(sc, workAge);
  const discRet = discretionaryAt(sc, retAge);
  const nwAtRet = r.fan?.real?.p50?.[retIdx + 1] ?? 0;
  const al = sc.allocation, mk = sc.market;
  const cagr = al.stocks * mk.stocks.real_cagr + al.bonds * mk.bonds.real_cagr + al.cash * mk.cash.real_cagr;
  const totalExp = exp.reduce((a, b) => a + b, 0);
  const activeShare = totalExp > 0
    ? exp.reduce((a, v, i) => a + (ages[i] <= 75 ? v : 0), 0) / totalExp : null;
  const rmd = r.rmds_median_real ?? [];
  let rmdSum = 0, spendSum = 0;
  for (let i = 0; i < ages.length; i++) if (ages[i] >= 75) { rmdSum += rmd[i] ?? 0; spendSum += exp[i] ?? 0; }
  const p50 = r.fan?.real?.p50 ?? [];
  // Social Security monthly benefit at FRA — the estimated PIA when the plan
  // derives it from covered earnings, otherwise the manual ssa.gov figure.
  const ssMonthly = sc.social_security.benefit_mode === "estimated"
    ? (r.ss_estimated_monthly_at_fra || sc.social_security.monthly_at_fra)
    : sc.social_security.monthly_at_fra;
  // Lifetime net healthcare cost (real $): ACA premium after subsidy + IRMAA
  // surcharges, summed over the per-year medians. null when neither is modeled
  // (out-of-pocket medical lives in the expense/medical streams, not here).
  const hc = r.healthcare?.net_cost_real;
  const healthcareCost = hc?.length ? hc.reduce((a, b) => a + (b ?? 0), 0) : null;
  return {
    // headline (folded in from the old pinned-scenarios table)
    mcNumber: s.mcNumber, mcPending: s.mcPending,
    successRate: r.success_rate,
    successThreshold: sc.sim.success_threshold,
    retireAge: retire,
    fiAge: fiAge(s),
    medianEnd: p50.length ? p50[p50.length - 1] : 0,
    medianShortfall: r.failure_magnitude?.median_total_shortfall_real ?? null,
    bridgeHolds: r.bridge?.has_bridge ? 1 - (r.bridge.bridge_break_rate ?? 0) : null,
    lifetimeTaxMed: r.lifetime_tax?.median_real ?? null,
    income, workSpend, retSpend, discWork, discRet, healthcareCost,
    ssLabel: ssMonthly > 0 ? `${fmtMoney(ssMonthly * 12)}/yr` : "—",
    secondaryStreams: (sc.income_streams ?? []).length,
    incomeChanges: (sc.events ?? []).filter((e) => e.kind === "regime_change"
      && (e.overrides?.gross_salary != null || e.overrides?.salary_real_growth != null)).length,
    savingsRate: workWage > 0 ? Math.max(0, (workWage - workTax - workSpend) / workWage) : null,
    activeShare,
    spendStrat: sc.spending_strategy.kind === "constant_dollar" ? "Steady Paycheck" : "Percent Of Portfolio",
    spendDetail: spendDetailLabel(sc),
    equity: al.stocks,
    cagr,
    allocChanges: sc.allocation_schedule?.length ?? 0,
    roth: rothLabel(sc.conversion_rule),
    withdrawRate: nwAtRet > 0 ? retSpend / nwAtRet : null,
    withdrawRateLiquid: liquidWithdrawalRate(s),
    maxDD: r.max_drawdown?.length ? median(r.max_drawdown) : null,
    effTax: r.lifetime_tax?.effective_rate ?? null,
    rmdRatio: spendSum > 0 ? rmdSum / spendSum : 0,
    yearsInCut: r.spending_distribution?.years_in_cut?.length ? median(r.spending_distribution.years_in_cut) : null,
    legacy: sc.sim.legacy_target,
  };
}
type Derived = ReturnType<typeof derive>;

interface Metric { label: string; show: (d: Derived) => string }
const SUMMARY_GROUPS: { title: string; metrics: Metric[] }[] = [
  { title: "Plan", metrics: [
    { label: "Planned Retirement Age", show: (d) => String(d.retireAge) },
    { label: "Success Threshold", show: (d) => fmtPct(d.successThreshold, 0) },
    { label: "Legacy Target", show: (d) => fmtMoney(d.legacy) },
  ] },
  { title: "Outcomes", metrics: [
    { label: "FIRE Number", show: (d) => d.mcNumber != null ? fmtMoney(d.mcNumber) : (d.mcPending ? "…" : "—") },
    { label: "Earliest FI Age", show: (d) => d.fiAge },
    { label: "Success Probability", show: (d) => fmtPct(d.successRate) },
    { label: "Retirement Bridge Holds", show: (d) => d.bridgeHolds != null ? fmtPct(d.bridgeHolds, 0) : "—" },
    { label: "Median Shortfall If It Fails", show: (d) => fmtMoney(d.medianShortfall) },
    { label: "Median Worst Drawdown", show: (d) => fmtPct(d.maxDD, 0) },
    { label: "Real Median Ending Net Worth", show: (d) => fmtMoney(d.medianEnd) },
  ] },
  { title: "Income", metrics: [
    { label: "Average Gross Income While Working", show: (d) => fmtMoney(d.income) },
    { label: "Income Changes", show: (d) => String(d.incomeChanges) },
    { label: "Secondary Income Sources", show: (d) => String(d.secondaryStreams) },
    { label: "Social Security At FRA", show: (d) => d.ssLabel },
  ] },
  { title: "Spending", metrics: [
    { label: "Total While Working", show: (d) => fmtMoney(d.workSpend) },
    { label: "Discretionary While Working", show: (d) => fmtMoney(d.discWork) },
    { label: "Total In Retirement", show: (d) => fmtMoney(d.retSpend) },
    { label: "Discretionary In Retirement", show: (d) => fmtMoney(d.discRet) },
    { label: "Retirement Strategy", show: (d) => d.spendStrat },
    { label: "Strategy Settings", show: (d) => d.spendDetail },
    { label: "Median Years In A Spending Cut", show: (d) => d.yearsInCut != null ? d.yearsInCut.toFixed(0) : "—" },
    { label: "Lifetime Net Healthcare Cost", show: (d) => fmtMoney(d.healthcareCost) },
    { label: "Share Spent Through Age 75", show: (d) => fmtPct(d.activeShare, 0) },
  ] },
  { title: "Portfolio", metrics: [
    { label: "Savings Rate While Working", show: (d) => fmtPct(d.savingsRate, 0) },
    { label: "Equity Allocation", show: (d) => fmtPct(d.equity, 0) },
    { label: "Assumed Real Return (CAGR)", show: (d) => fmtPct(d.cagr, 1) },
    { label: "Scheduled Allocation Changes", show: (d) => String(d.allocChanges) },
  ] },
  { title: "Withdrawals", metrics: [
    { label: "Roth Conversion Strategy", show: (d) => d.roth },
    { label: "Withdrawal Rate At Retirement — Total Net Worth", show: (d) => fmtPct(d.withdrawRate, 1) },
    { label: "Withdrawal Rate At Retirement — Liquid Only", show: (d) => fmtPct(d.withdrawRateLiquid, 1) },
  ] },
  { title: "Taxes", metrics: [
    { label: "Average Effective Tax Rate", show: (d) => fmtPct(d.effTax, 1) },
    { label: "Real Median Lifetime Tax", show: (d) => fmtMoney(d.lifetimeTaxMed) },
    { label: "RMDs As Share Of Spending After 75", show: (d) => fmtPct(d.rmdRatio, 0) },
  ] },
];

function SummaryTable({ slots, focusId }: { slots: CompareSlot[]; focusId: string | null }) {
  const derived = useMemo(() => new Map(slots.map((s) => [s.id, derive(s)])), [slots]);
  return (
    <div className="summary-scroll">
      <table className="table summary-table">
        <thead>
          <tr>
            <th />
            {slots.map((s) => (
              <th key={s.id} className={focusId && focusId !== s.id ? "is-dimmed" : ""}>
                <span className="scenario-chip-dot" style={{ background: s.color }} />{s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SUMMARY_GROUPS.map((g) => (
            <React.Fragment key={g.title}>
              <tr className="summary-group"><td colSpan={slots.length + 1}>{g.title}</td></tr>
              {g.metrics.map((metric) => (
                <tr key={metric.label}>
                  <td className="summary-label">{metric.label}</td>
                  {slots.map((s) => (
                    <td key={s.id} className={focusId && focusId !== s.id ? "is-dimmed" : ""}>
                      <span className="summary-val">{metric.show(derived.get(s.id)!)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Compare() {
  const { compare, addToCompare, clearCompare, result, axisMode } = useStore(useShallow((s) => ({
    compare: s.compare, addToCompare: s.addToCompare, clearCompare: s.clearCompare,
    result: s.result, axisMode: s.axisMode,
  })));
  const [focusId, setFocusId] = useState<string | null>(null);
  const anySweep = compare.some((c) => c.sweep);
  const anyBridge = compare.some((c) => c.result.bridge?.has_bridge);
  // a focus on a since-removed scenario should fall away
  const focus = compare.some((c) => c.id === focusId) ? focusId : null;
  const toggleFocus = (id: string) => setFocusId((f) => (f === id ? null : id));

  if (compare.length === 0) {
    return (
      <div className="stack">
        <Section
          title="Scenario Comparison"
          info="Pin the current scenario's results, tweak inputs, pin again — overlay as many as you like."
          actions={<button onClick={addToCompare} disabled={!result}>+ Pin Current Scenario</button>}>
          <p className="hint">
            Nothing pinned yet. Run a simulation, pin it, change something (allocation,
            retirement age, an event, guardrails), and pin again to compare futures side by side.
          </p>
        </Section>
      </div>
    );
  }

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "cmp-scenarios", label: "Scenarios" },
        { id: "cmp-success", label: "Success" },
        ...(anyBridge ? [{ id: "cmp-bridge", label: "Retirement Bridge" }] : []),
        { id: "cmp-outcomes", label: "Outcomes" },
      ]} />

      {/* ───────────── SCENARIOS ───────────── */}
      <Head id="cmp-scenarios">Scenarios</Head>
      <Section
        title="Scenario Details"
        info="The defining parameters and headline outcomes of each pinned scenario, side by side — so the comparison doesn't have to live in the scenario name. Click a chip to focus that scenario across every chart; double-click its name to rename; ✕ removes it."
        actions={
          <span className="pair">
            <button className="ghost" onClick={clearCompare}>Clear All</button>
            <button onClick={addToCompare} disabled={!result}>+ Pin Current Scenario</button>
          </span>
        }>
        <div className="scenario-chips">
          {compare.map((slot) => (
            <ScenarioChip key={slot.id} slot={slot}
              focused={focus === slot.id} onFocus={() => toggleFocus(slot.id)} />
          ))}
        </div>
        <SummaryTable slots={compare} focusId={focus} />
      </Section>

      {/* ───────────── SUCCESS ───────────── */}
      <Head id="cmp-success">Success</Head>
      <div className="grid2">
        {anySweep && (
          <Section
            title="Success Probability vs Retirement Age"
            info="The success-probability curves of every pinned scenario, overlaid. Where a curve crosses your threshold is that scenario's earliest safe retirement age.">
            <CompareSweepChart slots={compare} axisMode={axisMode} focusId={focus} height={380} />
          </Section>
        )}
        <Section title="Share Of Paths Still Funded" info={A.survival}>
          <CompareSurvivalChart slots={compare} axisMode={axisMode} focusId={focus} height={380} />
        </Section>
      </div>

      {/* ───────────── RETIREMENT BRIDGE ───────────── */}
      {anyBridge && (
        <>
          <Head id="cmp-bridge">Retirement Bridge</Head>
          <Section title="Bridge Confidence Side By Side" info={A.bridgeConfidence}>
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th><th>Bridge Holds</th><th>Liquid Needed</th>
                  <th>Liquid Available</th><th>Available ÷ Needed</th>
                  <th>Liquid Withdrawal Rate</th><th>Accessible @ Retirement</th>
                </tr>
              </thead>
              <tbody>
                {compare.map((slot) => {
                  const b = slot.result.bridge;
                  const dim = focus && focus !== slot.id ? "is-dimmed" : "";
                  if (!b) return (
                    <tr key={slot.id} className={dim}>
                      <td>{slot.name}</td>
                      <td colSpan={6} className="hint">Re-pin to compute bridge metrics</td>
                    </tr>
                  );
                  if (!b.has_bridge) return (
                    <tr key={slot.id} className={dim}>
                      <td>{slot.name}</td>
                      <td colSpan={6} className="hint">No bridge — retires at/after 59½</td>
                    </tr>
                  );
                  const need = b.bridge_funding_total_real ?? 0;
                  const ratio = need > 0 ? (b.at_retirement?.accessible_real ?? 0) / need : null;
                  return (
                    <tr key={slot.id} className={dim}>
                      <td>
                        <span className="scenario-chip-dot" style={{ background: slot.color }} />
                        {slot.name}
                      </td>
                      <td>{fmtPct(1 - (b.bridge_break_rate ?? 0), 0)}</td>
                      <td>{fmtMoney(b.bridge_funding_total_real)}</td>
                      <td>{fmtMoney(b.at_retirement?.accessible_real)}</td>
                      <td>{ratio != null ? `${ratio.toFixed(2)}×` : "—"}</td>
                      <td>{fmtPct(liquidWithdrawalRate(slot), 1)}</td>
                      <td>{fmtPct(b.at_retirement?.pct_accessible ?? 0, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 28 }}>
              <CompareBridgeChart slots={compare} axisMode={axisMode} focusId={focus} />
            </div>
          </Section>
        </>
      )}

      {/* ───────────── OUTCOMES ───────────── */}
      <Head id="cmp-outcomes">Outcomes</Head>
      <div className="grid2">
        <Section title="Median Net Worth" info="Each scenario's median projected net worth in today's dollars. Median lines only — the spread across paths is in the Ending Net Worth chart beside it, which stays readable however many scenarios you overlay.">
          <CompareChart slots={compare} axisMode={axisMode} focusId={focus} height={380} />
        </Section>
        <Section title="Ending Net Worth Distribution" info="The full spread of outcomes at the horizon, as a cumulative distribution: for any net-worth level, a curve's height is the share of Monte Carlo paths that end at or below it. Hover the vertical line to read every scenario's percentile at that dollar level; the dots mark each scenario's p10 / p50 / p90. A curve sitting to the right is better across the board; a steep early rise near $0 is downside risk.">
          <CompareEndingDistChart slots={compare} focusId={focus} height={380} />
        </Section>
      </div>
      <Section title="Enjoyment-Weighted Spending" info={A.fulfillment}>
        <CompareSatisfactionChart slots={compare} axisMode={axisMode} focusId={focus} />
        <p className="hint" style={{ maxWidth: "none" }}>
          Median real spending re-weighted by how much a dollar is worth at each age (full through 75, tapering to 30% by 90).
          A higher, more front-loaded line means more money lands while you can enjoy it — the
          early-spending-versus-oversaver trade-off, scenario by scenario.
        </p>
      </Section>
    </div>
  );
}
