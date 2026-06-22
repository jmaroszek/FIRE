import React, { useState } from "react";
import { A } from "../assumptions";
import { Field, InfoTip, NumberInput, PercentInput, Section, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";
import type { AssetParams, Scenario } from "../types";

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
  // How the asset-return fields are entered. Real is always what's stored; this
  // only controls the entry/display denomination (converted at mean inflation).
  const [returnMode, setReturnMode] = useState<"nominal" | "real">("nominal");
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const meanInfl = s.inflation.mean;
  const nominalMode = returnMode === "nominal";
  const toReal = (nom: number) => (1 + nom) / (1 + meanInfl) - 1;
  const toNominal = (real: number) => (1 + real) * (1 + meanInfl) - 1;
  // Inputs render the chosen denomination; storage is always real_cagr.
  const shownCagr = (real: number) => (nominalMode ? toNominal(real) : real);
  const storeCagr = (shown: number) => (nominalMode ? toReal(shown) : shown);
  const altCagr = (real: number) =>
    nominalMode ? `≈ ${fmtPct(real)} real` : `≈ ${fmtPct(toNominal(real))} nominal`;
  const isBootstrap = s.market.mode === "bootstrap";
  const upAsset = (key: "stocks" | "bonds" | "cash", patch: Partial<AssetParams>) =>
    up({ market: { ...s.market, [key]: { ...s.market[key], ...patch } } });

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
              info="A retirement age 'works' when at least this share of paths end with a balance ≥ the legacy target (never running out also counts).">
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
          {/* Mean Shift only affects bootstrap mode — in parametric the CAGRs are
              used directly, so it's hidden there to avoid a dead control. */}
          {isBootstrap && (
            <Field label="Mean Shift"
              info="Shifts historical returns so their long-run average matches your entered CAGRs, keeping history's volatility and correlations. Without it, returns come straight from history and your stock/bond CAGRs are ignored.">
              <input type="checkbox" checked={s.market.bootstrap_mean_shift}
                onChange={(e) => up({ market: { ...s.market, bootstrap_mean_shift: e.target.checked } })} />
            </Field>
          )}
        </div>

        <div className="returns-head">
          <span className="field-label">
            Asset Returns<InfoTip text={A.vol} />
          </span>
          <span className="seg">
            <button type="button" className={nominalMode ? "seg-on" : ""}
              onClick={() => setReturnMode("nominal")}>Nominal</button>
            <button type="button" className={!nominalMode ? "seg-on" : ""}
              onClick={() => setReturnMode("real")}>Real</button>
          </span>
        </div>
        <div className="asset-matrix">
          <div className="asset-matrix-row asset-matrix-head">
            <span />
            <span>{nominalMode ? "Nominal CAGR" : "Real CAGR"}</span>
            <span>Volatility</span>
          </div>
          {(["stocks", "bonds"] as const).map((key) => (
            <div className="asset-matrix-row" key={key}>
              <span className="asset-name">{key === "stocks" ? "Stocks" : "Bonds"}</span>
              <span className="cagr-cell">
                <PercentInput value={shownCagr(s.market[key].real_cagr)} step={0.25}
                  onChange={(v) => upAsset(key, { real_cagr: storeCagr(v) })} />
                <span className="cagr-alt">{altCagr(s.market[key].real_cagr)}</span>
              </span>
              <PercentInput value={s.market[key].vol} step={1}
                onChange={(v) => upAsset(key, { vol: v })} />
            </div>
          ))}
        </div>

        <div className="fields" style={{ marginTop: 14 }}>
          <Field label="Expense Ratio" info={A.expenseRatio}>
            <PercentInput value={s.market.expense_ratio} step={0.01}
              onChange={(v) => up({ market: { ...s.market, expense_ratio: v } })} />
          </Field>
          <Field label="Cash APY" info={A.cash}>
            <span className="cagr-cell-inline">
              <PercentInput value={shownCagr(s.market.cash.real_cagr)} step={0.25}
                onChange={(v) => upAsset("cash", { real_cagr: storeCagr(v) })} />
              <span className="cagr-alt">{altCagr(s.market.cash.real_cagr)}</span>
            </span>
          </Field>
        </div>

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
              <Row label="Stocks / Bonds (Real CAGR)"
                value={`${fmtPct(s.market.stocks.real_cagr)} / ${fmtPct(s.market.bonds.real_cagr)}`} />
              <Row label="Cash / HYSA (Real)" value={fmtPct(s.market.cash.real_cagr)} />
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
