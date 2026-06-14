import React, { useState } from "react";
import { A } from "../assumptions";
import { MarginalRateChart, TaxesChart } from "../components/charts";
import {
  Field, Group, InfoTip, NumberInput, PercentInput, Section, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { useStore } from "../store";
import type { Scenario } from "../types";

export default function Taxes() {
  const { scenario, result, axisMode, taxregime, taxregimeLoading, runTaxRegime } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [sunsetAge, setSunsetAge] = useState(scenario ? scenario.retirement_age : 60);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  // The conversion strategy is presented as one dropdown; "Custom Target" maps
  // to a fill_bracket with a custom ceiling, so derive the selection from both.
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
      <div className="stat-grid">
        <Section title="Lifetime Tax" info={A.lifetimeTax}>
          {result ? (
            <Stat label="Median Lifetime Tax (Today's $)"
              value={fmtMoney(result.lifetime_tax.median_real)}
              sub={`${fmtPct(result.lifetime_tax.as_pct_of_spending)} of lifetime spending`}
              info={A.lifetimeTax} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>
      </div>

      <Section title="Marginal Tax Rate Over Time" info={A.marginalCurve}>
        {result ? (
          <MarginalRateChart result={result} axisMode={axisMode}
            retirementAge={s.retirement_age}
            claimingAge={s.social_security.claiming_age}
            birthYear={s.profile.birth_year} />
        ) : (
          <p className="hint">Simulation pending…</p>
        )}
      </Section>

      <Section title="Tax-Law Stress (TCJA Sunset)" info={A.taxRegime}
        actions={taxregime && (
          <button className="ghost" onClick={() => runTaxRegime(sunsetAge)} disabled={taxregimeLoading}>
            {taxregimeLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        <div className="fields">
          <Field label="Reversion Starts At Age"
            info="The age today's tax law reverts: ordinary brackets ×1.15 and the standard deduction roughly halved — a documented approximation of a TCJA-style sunset, not an exact pre-2018 table.">
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

      <Section className="span2" title="Annual Taxes" info={A.taxes}>
        <div className="fields">
          <Field label="State Tax (Flat)" info={A.taxes}>
            <PercentInput value={s.profile.state_tax_rate}
              onChange={(v) => up({ profile: { ...s.profile, state_tax_rate: v } })} />
          </Field>
        </div>
        {result ? (
          <TaxesChart result={result} axisMode={axisMode} />
        ) : (
          <p className="hint">Simulation pending…</p>
        )}
      </Section>

      <Group title="Traditional Drawdown">
        <Section title="Roth Conversion Ladder"
          info={A.ladder + " Conversions are capped by the traditional balance each year — 401k money counts because leaving work lets you roll it into a traditional IRA, where conversions start. Amounts are the median across paths."}>
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
                info="Fill ordinary income to this taxable-income level each year (today's $), net of RMDs, Social Security, and traditional spending withdrawals — the same smart fill as the bracket presets, just to a line you choose. Lands you between the brackets: the 12% bracket tops out at $50,400 of taxable income, the 22% at $105,700. Watch the Next $ Taxed At column to see what going higher costs.">
                <NumberInput value={cr.custom_top ?? 0} step={1000}
                  onChange={(v) => up({ conversion_rule: { ...cr, custom_top: v } })} />
              </Field>
            )}
            <Field label="From / Until Age"
              info="Defaults: start at retirement, stop at 72. The ladder does two jobs: before 59½ each rung becomes penalty-free after 5 years to fund the bridge; from 59½ to ~72 it keeps draining traditional at a low bracket to shrink the balance that drives RMDs (forced at 75). Conversions auto-stop once RMDs and other income already fill your chosen bracket — watch the Next $ Taxed At column.">
              <span className="pair agecell">
                <NumberInput value={s.conversion_rule.start_age ?? s.retirement_age} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, start_age: v } })} />
                –
                <NumberInput value={s.conversion_rule.end_age ?? 72} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, end_age: v } })} />
              </span>
            </Field>
            {cr.start_age != null && cr.start_age !== s.retirement_age && (
              <button type="button" className="link-action"
                onClick={() => up({ conversion_rule: { ...cr, start_age: null } })}
                title="Reset the ladder's start age back to your retirement age, and keep it in sync if you change the retirement age later.">
                ↺ Reset Start To Retirement ({s.retirement_age})
              </button>
            )}
          </div>
          {result && result.ladder_schedule.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th><th>Age</th><th>Convert (Today's $)</th>
                  <th>Penalty-Free In</th>
                  <th>Next $ Taxed At<InfoTip text="Marginal federal + state rate the NEXT dollar of conversion would face on the median path: your bracket rate, amplified where it drags more Social Security into tax (the 'torpedo') or pushes long-term gains out of the 0% bracket. Much higher than your bracket target's headline rate → stop filling; still low → room to convert more." /></th>
                  <th>Traditional Left<InfoTip text="Median traditional (IRA + rolled-over 401k) balance remaining after that year's conversion and growth, in today's dollars." /></th>
                </tr>
              </thead>
              <tbody>
                {result.ladder_schedule.map((r) => {
                  // penalty-free at the earlier of 5-year seasoning or turning 60
                  // (at 59½ all conversion principal is penalty-free regardless)
                  const penaltyFree = r.age >= 60
                    ? "Immediate"
                    : Math.min(r.matures, s.profile.birth_year + 60);
                  return (
                    <tr key={r.year}>
                      <td>{r.year}</td>
                      <td>{r.age}</td>
                      <td>{fmtMoney(r.amount_real)}</td>
                      <td>{penaltyFree}</td>
                      <td>{fmtPct(r.marginal_rate, 0)}</td>
                      <td>{fmtMoney(r.trad_remaining_real)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              No conversions in the median path. Pick a strategy above to build
              penalty-free income for the bridge years.
            </p>
          )}
        </Section>

        <Section title="Projected RMDs"
          info="From age 75 the IRS forces a minimum withdrawal from traditional accounts each year (balance ÷ an age-based divisor), taxed as ordinary income whether you need it or not. This is the scoreboard for your conversion ladder: if these land in a high bracket, lower the Bracket Top / Custom Target above so you drain more traditional before 75. Median path, today's dollars.">
          {result && result.rmd_schedule && result.rmd_schedule.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th><th>Age</th><th>RMD (Today's $)</th>
                  <th>Taxed At<InfoTip text="Marginal federal + state rate on the next ordinary dollar that year — the bracket your RMD, stacked with Social Security, pushes you into. High here means convert more (to a lower target) before 75." /></th>
                  <th>Traditional Left<InfoTip text="Median traditional (IRA + rolled-over 401k) balance remaining after that year's RMD and growth, in today's dollars." /></th>
                </tr>
              </thead>
              <tbody>
                {result.rmd_schedule.map((r) => (
                  <tr key={r.year}>
                    <td>{r.year}</td>
                    <td>{r.age}</td>
                    <td>{fmtMoney(r.amount_real)}</td>
                    <td>{fmtPct(r.marginal_rate, 0)}</td>
                    <td>{fmtMoney(r.trad_remaining_real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              No projected RMDs — either your horizon ends before age 75, or your
              traditional balance is drained before then (a sign your ladder has
              fully defused the RMD bomb).
            </p>
          )}
        </Section>
      </Group>
    </div>
  );
}
