import React, { useState } from "react";
import { A } from "../assumptions";
import { AnnualTaxRateChart, TradOverfundingChart, WealthFlowsChart } from "../components/charts";
import {
  Field, Group, InfoTip, NumberInput, PercentInput, Section, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { useStore } from "../store";
import type { Scenario } from "../types";

export default function Taxes() {
  const { scenario, result, axisMode, taxregime, taxregimeLoading, runTaxRegime,
          rothtrad, runRothTrad, rothtradLoading } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [sunsetAge, setSunsetAge] = useState(scenario ? scenario.retirement_age : 60);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const cr = s.conversion_rule;
  const convStrategy =
    cr.kind === "none" ? "none"
    : cr.kind === "fill_bracket" && cr.bracket_top === "custom" ? "custom"
    : "fill_bracket";
  const setConvStrategy = (v: string) => {
    if (v === "none") up({ conversion_rule: { ...cr, kind: "none" } });
    else if (v === "custom") up({ conversion_rule: { ...cr, kind: "fill_bracket", bracket_top: "custom" } });
    else up({ conversion_rule: { ...cr, kind: "fill_bracket", bracket_top: cr.bracket_top === "custom" ? "12" : cr.bracket_top } });
  };

  return (
    <div className="stack">
      <Section className="full" title="Where The Money Lives — Balances & Flows"
        info="Median balance of each tax pool over the plan (left axis), with annual contributions and withdrawals as bars (right). Watch the mix shift as you accumulate, convert, and draw down.">
        {result ? <WealthFlowsChart result={result} axisMode={axisMode} />
          : <p className="hint">Simulation pending…</p>}
      </Section>

      <Group title="Roth vs Traditional">
        <Section className="span1" title="Roth vs Traditional Contributions (IRA + 401k)" info={A.rothTrad}
          actions={rothtrad && (
            <button className="ghost" onClick={runRothTrad} disabled={rothtradLoading}>
              {rothtradLoading ? "Computing…" : "Recompute"}
            </button>
          )}>
          {rothtrad ? (
            <>
              <table className="table">
                <thead><tr><th /><th>Traditional</th><th>Roth</th></tr></thead>
                <tbody>
                  <tr><td>Success Probability</td>
                    <td>{fmtPct(rothtrad.trad.success_rate)}</td>
                    <td>{fmtPct(rothtrad.roth.success_rate)}</td></tr>
                  <tr><td>Lifetime Tax (Today's $)</td>
                    <td>{fmtMoney(rothtrad.trad.lifetime_tax_real)}</td>
                    <td>{fmtMoney(rothtrad.roth.lifetime_tax_real)}</td></tr>
                  <tr><td>Median Ending Net Worth</td>
                    <td>{fmtMoney(rothtrad.trad.ending_real)}</td>
                    <td>{fmtMoney(rothtrad.roth.ending_real)}</td></tr>
                </tbody>
              </table>
              <p className="hint">
                Routing tax-advantaged contributions to{" "}
                <strong>{rothtrad.ending_diff >= 0 ? "Roth" : "Traditional"}</strong>{" "}
                ends with {fmtMoney(Math.abs(rothtrad.ending_diff))} more net worth (today's $);
                lifetime tax differs by {fmtMoney(Math.abs(rothtrad.tax_diff))}. Roth often wins on
                success even when Traditional wins on ending wealth — the Roth's liquidity helps
                the pre-59½ bridge.
              </p>
            </>
          ) : (
            <button onClick={runRothTrad} disabled={rothtradLoading}>
              {rothtradLoading ? "Computing…" : "Compare"}
            </button>
          )}
        </Section>

        <Section className="span1" title="Lifetime Tax" info={A.lifetimeTax}>
          {result ? (
            <Stat label="Median Lifetime Tax (Today's $)"
              value={fmtMoney(result.lifetime_tax.median_real)}
              sub={`${fmtPct(result.lifetime_tax.as_pct_of_spending)} of lifetime spending`}
              info={A.lifetimeTax} />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>
      </Group>

      <Section title="Taxes Over Time — Annual $, Marginal & Effective Rate" info={A.marginalCurve}>
        {result ? (
          <AnnualTaxRateChart result={result} axisMode={axisMode}
            retirementAge={s.retirement_age} claimingAge={s.social_security.claiming_age}
            birthYear={s.profile.birth_year} />
        ) : <p className="hint">Simulation pending…</p>}
        <div className="fields" style={{ marginTop: 8 }}>
          <Field label="State Tax (Flat)" info={A.taxes}>
            <PercentInput value={s.profile.state_tax_rate}
              onChange={(v) => up({ profile: { ...s.profile, state_tax_rate: v } })} />
          </Field>
        </div>
      </Section>

      <Group title="Traditional Drawdown">
        <Section title="Roth Conversion Ladder"
          info={A.ladder + " Conversions are capped by the traditional balance each year. Amounts are the median across paths."}>
          <div className="fields" style={{ marginBottom: 10 }}>
            <Field label="Strategy">
              <select value={convStrategy} onChange={(e) => setConvStrategy(e.target.value)}>
                <option value="none">None</option>
                <option value="fill_bracket">Fill To Bracket Top</option>
                <option value="custom">Custom Target</option>
              </select>
            </Field>
            {convStrategy === "fill_bracket" && (
              <Field label="Bracket Top">
                <select value={cr.bracket_top}
                  onChange={(e) => up({ conversion_rule: { ...cr, bracket_top: e.target.value as any } })}>
                  <option value="std_deduction">Std Deduction (0%)</option>
                  <option value="10">10% Top</option>
                  <option value="12">12% Top</option>
                  <option value="22">22% Top</option>
                </select>
              </Field>
            )}
            {convStrategy === "custom" && (
              <Field label="Taxable-Income Target"
                info="Fill ordinary income to this taxable-income level each year (today's $), net of RMDs, SS, and traditional spending withdrawals.">
                <NumberInput value={cr.custom_top ?? 0} step={1000}
                  onChange={(v) => up({ conversion_rule: { ...cr, custom_top: v } })} />
              </Field>
            )}
            <Field label="From / Until Age"
              info="Defaults: start at retirement, stop at 72. Before 59½ each rung becomes penalty-free after 5 years; from 59½ to ~72 it keeps draining traditional at a low bracket to shrink RMDs.">
              <span className="pair agecell">
                <NumberInput value={s.conversion_rule.start_age ?? s.retirement_age} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, start_age: v } })} />
                –
                <NumberInput value={s.conversion_rule.end_age ?? 72} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, end_age: v } })} />
              </span>
            </Field>
          </div>
          {result && result.ladder_schedule.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th><th>Age</th><th>Convert (Today's $)</th><th>Penalty-Free In</th>
                  <th>Next $ Taxed At<InfoTip text="Marginal federal + state rate the next conversion dollar would face on the median path." /></th>
                  <th>Traditional Left<InfoTip text="Median traditional balance after that year's conversion and growth, today's $." /></th>
                </tr>
              </thead>
              <tbody>
                {result.ladder_schedule.map((r) => {
                  const penaltyFree = r.age >= 60 ? "Immediate"
                    : Math.min(r.matures, s.profile.birth_year + 60);
                  return (
                    <tr key={r.year}>
                      <td>{r.year}</td><td>{r.age}</td><td>{fmtMoney(r.amount_real)}</td>
                      <td>{penaltyFree}</td><td>{fmtPct(r.marginal_rate, 0)}</td>
                      <td>{fmtMoney(r.trad_remaining_real)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="hint">No conversions in the median path. Pick a strategy above to build penalty-free income for the bridge years.</p>
          )}
        </Section>

        <Section title="Projected RMDs"
          info="From age 75 the IRS forces a minimum withdrawal from traditional accounts, taxed as ordinary income. If these land in a high bracket, lower the Bracket Top above so you drain more traditional before 75. Median path, today's dollars.">
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
      </Group>

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
                    sub={`spending that year ≈ ${fmtMoney(spendThen)}`} info={A.tradOverfunding} />
                  <Stat label="Forced Beyond Spending" value={overshoot > 0 ? fmtMoney(overshoot) : "—"}
                    sub={overshoot > 0 ? "ordinary income you must realize but don't need"
                      : "the RMD stays within your spending"} />
                </div>
              );
            })()}
            <TradOverfundingChart result={result} axisMode={axisMode} birthYear={s.profile.birth_year} />
          </>
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Tax-Law Stress (TCJA Sunset)" info={A.taxRegime}
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
          {!taxregime && (
            <button onClick={() => runTaxRegime(sunsetAge)} disabled={taxregimeLoading}>
              {taxregimeLoading ? "Computing…" : "Run Stress Test"}
            </button>
          )}
        </div>
        {taxregime && (
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <Stat label="Baseline Success" value={fmtPct(taxregime.base_success)} />
            <Stat label={`After Reversion At ${taxregime.sunset_age}`}
              value={fmtPct(taxregime.stressed_success)}
              sub={`${taxregime.delta >= 0 ? "+" : ""}${fmtPct(taxregime.delta)} vs baseline`} />
            <Stat label="Lifetime Tax: Baseline → Reverted"
              value={`${fmtMoney(taxregime.base_lifetime_tax_real)} → ${fmtMoney(taxregime.stressed_lifetime_tax_real)}`}
              sub={`+${fmtMoney(taxregime.stressed_lifetime_tax_real - taxregime.base_lifetime_tax_real)} more tax (today's $)`} />
          </div>
        )}
      </Section>
    </div>
  );
}
