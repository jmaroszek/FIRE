import React from "react";
import { A } from "../assumptions";
import { Field, NumberInput, PercentInput, Section, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";
import type { Scenario } from "../types";

/** One labelled row in the read-only Assumptions Summary. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ color: "var(--muted)" }}>{label}</td>
      <td style={{ textAlign: "right" }}>{value}</td>
    </tr>
  );
}

export default function Assumptions() {
  const { scenario } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const assets = s.accounts.reduce((a, x) => a + x.balance, 0);
  const debt = (s.liabilities ?? []).reduce((a, l) => a + l.balance, 0);
  const planAnnual = s.expense_streams.reduce((a, e) => a + e.annual, 0);
  const cr = s.conversion_rule;
  const convLabel =
    cr.kind === "none" ? "None"
    : cr.bracket_top === "custom" ? `Custom ${fmtMoney(cr.custom_top ?? 0)}`
    : `Fill ${cr.bracket_top === "std_deduction" ? "Std Deduction" : cr.bracket_top + "%"}`;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Profile">
          <div className="fields">
            <Field label="Birth Year">
              <NumberInput value={s.profile.birth_year} step={1}
                onChange={(v) => up({ profile: { ...s.profile, birth_year: v } })} />
            </Field>
            <Field label="Coast Target Age">
              <NumberInput value={s.sim.coast_target_age} step={1}
                onChange={(v) => up({ sim: { ...s.sim, coast_target_age: v } })} />
            </Field>
            <Field label="Plan To">
              <NumberInput value={s.profile.horizon_age} step={1} min={50} max={105}
                onChange={(v) => up({ profile: { ...s.profile, horizon_age: v } })} />
            </Field>
            <Field label="Legacy (Today's $)" info={A.legacy}>
              <NumberInput value={s.sim.legacy_target} step={10000} min={0}
                onChange={(v) => up({ sim: { ...s.sim, legacy_target: v } })} />
            </Field>
            <Field label="State Tax"
              info="Flat rate on taxable income — set once for where you'll live; you won't tweak it often.">
              <PercentInput value={s.profile.state_tax_rate} step={0.5}
                onChange={(v) => up({ profile: { ...s.profile, state_tax_rate: v } })} />
            </Field>
          </div>
        </Section>

        <Section title="Simulation">
          <div className="fields">
            <Field label="Monte Carlo Paths"
              info="More paths = smoother percentiles, slower recompute. 2,000 runs in ~200 ms.">
              <NumberInput value={s.sim.n_paths} step={500} min={100} max={20000}
                onChange={(v) => up({ sim: { ...s.sim, n_paths: v } })} />
            </Field>
            <Field label="Random Seed">
              <NumberInput value={s.sim.seed} step={1}
                onChange={(v) => up({ sim: { ...s.sim, seed: v } })} />
            </Field>
            <Field label="Success Threshold"
              info="A retirement age 'works' when at least this share of paths never run out of money.">
              <PercentInput value={s.sim.success_threshold} step={1}
                onChange={(v) => up({ sim: { ...s.sim, success_threshold: v } })} />
            </Field>
          </div>
        </Section>
      </div>

      <div className="stat-grid">
      <Section title="Market Model" info={A.cagr}>
        <div className="fields">
          <Field label="Mode" info={A.bootstrap}>
            <select value={s.market.mode}
              onChange={(e) => up({ market: { ...s.market, mode: e.target.value as any } })}>
              <option value="bootstrap">Historical Bootstrap</option>
              <option value="parametric">Parametric (Lognormal)</option>
            </select>
          </Field>
          <Field label="Stocks (CAGR / Vol)" info={A.vol}>
            <span className="pair">
              <PercentInput value={s.market.stocks.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, real_cagr: v } } })} />
              <PercentInput value={s.market.stocks.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, vol: v } } })} />
            </span>
          </Field>
          <Field label="Bonds (CAGR / Vol)" info={A.vol}>
            <span className="pair">
              <PercentInput value={s.market.bonds.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, real_cagr: v } } })} />
              <PercentInput value={s.market.bonds.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, vol: v } } })} />
            </span>
          </Field>
          <Field label="Expense Ratio" info={A.expenseRatio}>
            <PercentInput value={s.market.expense_ratio} step={0.01}
              onChange={(v) => up({ market: { ...s.market, expense_ratio: v } })} />
          </Field>
          <Field label="Mean Shift"
            info="Bootstrap mode only: shifts historical returns so their long-run average matches your entered CAGRs, keeping history's volatility and correlations.">
            <input type="checkbox" checked={s.market.bootstrap_mean_shift}
              onChange={(e) => up({ market: { ...s.market, bootstrap_mean_shift: e.target.checked } })} />
          </Field>
        </div>
        <p className="hint">Your portfolio allocation (and any age-based glide) lives on the Accounts tab — it's a choice you make, not a market assumption.</p>
      </Section>

      <Section title="Inflation" info={A.inflation}>
        <div className="fields">
          <Field label="Mean">
            <PercentInput value={s.inflation.mean} step={0.25}
              onChange={(v) => up({ inflation: { ...s.inflation, mean: v } })} />
          </Field>
          <Field label="Persistence (AR1)">
            <NumberInput value={s.inflation.persistence} step={0.05} min={0} max={0.95}
              onChange={(v) => up({ inflation: { ...s.inflation, persistence: v } })} />
          </Field>
          <Field label="Volatility">
            <PercentInput value={s.inflation.sigma} step={0.25}
              onChange={(v) => up({ inflation: { ...s.inflation, sigma: v } })} />
          </Field>
        </div>
        <p className="hint">Bootstrap mode samples inflation jointly with returns from history; these AR(1) settings apply to parametric mode.</p>
      </Section>
      </div>

      <Section title="Assumptions Summary"
        info="A read-only roll-up of the whole scenario — every assumption in one place, regardless of which tab you set it on. Use it to audit a plan before saving or comparing.">
        <div className="group-grid">
          <table className="table" style={{ maxWidth: 380 }}>
            <tbody>
              <tr><td colSpan={2} className="snap-head" style={{ margin: 0 }}>Profile & Market</td></tr>
              <Row label="Born / Plan To" value={`${s.profile.birth_year} → age ${s.profile.horizon_age}`} />
              <Row label="State Tax" value={fmtPct(s.profile.state_tax_rate, 1)} />
              <Row label="Market Mode" value={s.market.mode === "bootstrap" ? "Bootstrap" : "Parametric"} />
              <Row label="Stocks / Bonds CAGR"
                value={`${fmtPct(s.market.stocks.real_cagr)} / ${fmtPct(s.market.bonds.real_cagr)}`} />
              <Row label="Allocation (S/B/C)"
                value={`${fmtPct(s.allocation.stocks, 0)} / ${fmtPct(s.allocation.bonds, 0)} / ${fmtPct(s.allocation.cash, 0)}`} />
              <Row label="Allocation Glide"
                value={(s.allocation_schedule ?? []).length > 0 ? `${(s.allocation_schedule ?? []).length} phase(s)` : "—"} />
              <Row label="Inflation Mean" value={fmtPct(s.inflation.mean)} />
            </tbody>
          </table>

          <table className="table" style={{ maxWidth: 380 }}>
            <tbody>
              <tr><td colSpan={2} className="snap-head" style={{ margin: 0 }}>Money & Plan</td></tr>
              <Row label="Gross Salary" value={fmtMoney(s.income.gross_salary)} />
              <Row label="Income Streams" value={String((s.income_streams ?? []).length)} />
              <Row label="Retirement Age" value={String(s.retirement_age)} />
              <Row label="Assets / Debt" value={`${fmtMoney(assets)} / ${fmtMoney(debt)}`} />
              <Row label="Planned Expenses" value={`${fmtMoney(planAnnual)}/yr`} />
              <Row label="Spending Strategy" value={s.spending_strategy.kind} />
            </tbody>
          </table>

          <table className="table" style={{ maxWidth: 380 }}>
            <tbody>
              <tr><td colSpan={2} className="snap-head" style={{ margin: 0 }}>Tax & Health</td></tr>
              <Row label="Conversion Ladder" value={convLabel} />
              <Row label="Social Security"
                value={`${fmtMoney(s.social_security.monthly_at_fra)}/mo @ ${s.social_security.claiming_age}`} />
              <Row label="ACA Subsidy" value={s.aca.enabled ? "On" : "Off"} />
              <Row label="IRMAA" value={s.irmaa.enabled ? "On" : "Off"} />
              <Row label="HSA Utilization" value={fmtPct(s.hsa.utilization, 0)} />
              <Row label="MC Paths / Threshold"
                value={`${s.sim.n_paths.toLocaleString()} / ${fmtPct(s.sim.success_threshold, 0)}`} />
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
