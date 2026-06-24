import React, { useState, useEffect } from "react";
import { A } from "../assumptions";
import { AnnualTaxRateChart, TradOverfundingChart } from "../components/charts";
import {
  Field, InfoTip, NumberInput, Section, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import type { Scenario } from "../types";

export default function Taxes() {
  const { scenario, result, axisMode, taxregime, taxregimeLoading, runTaxRegime,
          laddersavings, runLadderSavings, laddersavingsLoading } = useStore(useShallow((s) => ({
    scenario: s.scenario, result: s.result, axisMode: s.axisMode,
    taxregime: s.taxregime, taxregimeLoading: s.taxregimeLoading, runTaxRegime: s.runTaxRegime,
    laddersavings: s.laddersavings, runLadderSavings: s.runLadderSavings, laddersavingsLoading: s.laddersavingsLoading,
  })));
  const setScenario = useStore((s) => s.setScenario);
  const [sunsetAge, setSunsetAge] = useState(scenario ? scenario.retirement_age : 60);

  // Both readouts are cheap, so compute them automatically once the simulation
  // lands (the store nulls them on every edit, so this re-fires per scenario).
  useEffect(() => {
    if (result && !laddersavings && !laddersavingsLoading) void runLadderSavings();
  }, [result, laddersavings, laddersavingsLoading, runLadderSavings]);
  useEffect(() => {
    if (result && !taxregime && !taxregimeLoading) void runTaxRegime(sunsetAge);
  }, [result, taxregime, taxregimeLoading, runTaxRegime, sunsetAge]);

  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Lifetime Tax" info={A.lifetimeTax}>
          {result ? (
            <Stat label="Median Lifetime Tax (Today's $)"
              value={fmtMoney(result.lifetime_tax.median_real)}
              sub={`${fmtPct(result.lifetime_tax.as_pct_of_spending)} of lifetime spending`} />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>

        <Section title="Effective Lifetime Tax Rate" info={A.effLifetimeTax}>
          {result ? (
            <Stat label="Tax ÷ Lifetime Income"
              value={fmtPct(result.lifetime_tax.effective_rate)}
              sub="federal + state + FICA over all income you earn" />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>

        <Section title="Tax Saved By The Ladder" info={A.ladderSavings}>
          {laddersavings ? (
            <Stat label="Lifetime Tax Saved vs No Conversions"
              value={fmtMoney(laddersavings.saved_real)}
              sub={`${fmtMoney(laddersavings.without_ladder_real)} without → ${fmtMoney(laddersavings.with_ladder_real)} with`} />
          ) : <p className="hint">{laddersavingsLoading ? "Computing…" : "Simulation pending…"}</p>}
        </Section>
      </div>

      <Section title="Taxes Over Time" info={A.marginalCurve}>
        {result ? (
          <AnnualTaxRateChart result={result} axisMode={axisMode}
            retirementAge={s.retirement_age} claimingAge={s.social_security.claiming_age}
            birthYear={s.profile.birth_year} />
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      <div className="stat-grid">
      <Section title="Projected RMDs"
        info="From age 75 the IRS forces a minimum withdrawal from traditional accounts, taxed as ordinary income. If these land in a high bracket, lower the conversion-ladder Bracket Top on the Accounts tab so you drain more traditional before 75. Median path, today's dollars.">
        {result && result.rmd_schedule && result.rmd_schedule.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th><th>Age</th><th>RMD (Today's $)</th>
                <th>Taxed At<InfoTip text="Marginal federal + state rate on the next ordinary dollar that year." /></th>
                <th>Traditional Left<InfoTip text="Median traditional balance after that year's RMD and growth, today's $." /></th>
              </tr>
            </thead>
            <tbody>
              {result.rmd_schedule.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td><td>{r.age}</td><td>{fmtMoney(r.amount_real)}</td>
                  <td>{fmtPct(r.marginal_rate, 0)}</td><td>{fmtMoney(r.trad_remaining_real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">No projected RMDs — either your horizon ends before 75, or your traditional balance is drained before then (your ladder defused the RMD bomb).</p>
        )}
      </Section>

      <Section title="Traditional Over-Funding" info={A.tradOverfunding}>
        {result ? (
          <>
            {result.rmd_schedule.length > 0 && (() => {
              const startAge = s.sim.start_year - s.profile.birth_year;
              const first = result.rmd_schedule[0];
              const spendThen = result.expenses_median_real[first.age - startAge] ?? 0;
              const overshoot = first.amount_real - spendThen;
              return (
                <div className="stat-grid">
                  <Stat label={`First RMD (Age ${first.age})`} value={fmtMoney(first.amount_real)}
                    sub={`spending that year ≈ ${fmtMoney(spendThen)}`} />
                  <Stat label="Forced Beyond Spending" value={fmtMoney(Math.max(overshoot, 0))}
                    sub={overshoot > 0 ? "ordinary income you must realize but don't need"
                      : "the RMD stays within your spending"} />
                </div>
              );
            })()}
            <div style={{ marginTop: 16 }}>
              <TradOverfundingChart result={result} axisMode={axisMode} birthYear={s.profile.birth_year} />
            </div>
          </>
        ) : <p className="hint">Simulation pending…</p>}
      </Section>
      </div>

      <div className="group-grid stretch">
      <Section title="Tax-Law Stress (TCJA Sunset)" className="span2" info={A.taxRegime}
        actions={taxregime && (
          <button className="ghost" onClick={() => runTaxRegime(sunsetAge)} disabled={taxregimeLoading}>
            {taxregimeLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        <div className="fields">
          <Field label="Reversion Starts At Age"
            info="The age today's tax law reverts: ordinary brackets ×1.15 and the standard deduction roughly halved — a TCJA-style sunset approximation.">
            <NumberInput value={sunsetAge} step={1} min={s.sim.start_year - s.profile.birth_year}
              max={s.profile.horizon_age} onChange={setSunsetAge} />
          </Field>
        </div>
        {taxregime ? (
          <div className="stat-grid" style={{ marginTop: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Stat label="Baseline Success" value={fmtPct(taxregime.base_success)} />
            <Stat label={`After Reversion At ${taxregime.sunset_age}`}
              value={fmtPct(taxregime.stressed_success)}
              sub={`${taxregime.delta >= 0 ? "+" : ""}${fmtPct(taxregime.delta)} vs baseline`} />
            <Stat label="Lifetime Tax: Baseline → Reverted"
              value={`${fmtMoney(taxregime.base_lifetime_tax_real)} → ${fmtMoney(taxregime.stressed_lifetime_tax_real)}`}
              sub={`+${fmtMoney(taxregime.stressed_lifetime_tax_real - taxregime.base_lifetime_tax_real)} more tax (today's $)`} />
          </div>
        ) : (
          <p className="hint" style={{ marginTop: 10 }}>
            {taxregimeLoading ? "Computing…" : "Simulation pending…"}
          </p>
        )}
      </Section>

      <Section title="IRMAA Medicare Surcharge (65+)" className="span1" info={A.irmaa}>
        <div className="fields">
          <Field label="Enabled">
            <input type="checkbox" checked={s.irmaa.enabled}
              onChange={(e) => up({ irmaa: { ...s.irmaa, enabled: e.target.checked } })} />
          </Field>
        </div>
        <p className="hint">Uses the 2025 single-filer Part B + D tiers (the surcharge starts above ~$106k MAGI). A high Roth-conversion or RMD year can trip a tier — cross-check the conversion ladder (Accounts) and the RMD table above.</p>
      </Section>
      </div>
    </div>
  );
}
