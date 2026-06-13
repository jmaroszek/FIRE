import React, { useEffect } from "react";
import { A } from "../assumptions";
import { AccessibilityChart, SweepChart } from "../components/charts";
import {
  Field, Group, InfoTip, NumberInput, PercentInput, ProgressBar, Section, Stat,
  fmtMoney, fmtPct,
} from "../components/ui";
import { SOURCE_LABELS } from "../labels";
import { useStore } from "../store";
import type { Scenario, WithdrawalSource } from "../types";

// Fallbacks for scenarios from older data/backends that predate `late_order`.
const DEFAULT_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "roth_basis", "roth_matured_conversions", "trad", "hsa", "roth_earnings"];
const DEFAULT_LATE_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "trad", "hsa", "roth_matured_conversions", "roth_basis", "roth_earnings"];

export default function Freedom() {
  const { scenario, result, freedom, freedomLoading, runFreedom, sweep, runSweep,
          sweeping, axisMode } = useStore();
  const setScenario = useStore((s) => s.setScenario);

  useEffect(() => {
    if (scenario && !freedom && !freedomLoading) void runFreedom();
  }, [scenario, freedom]);

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
  const startAge = s.sim.start_year - s.profile.birth_year;
  // earliest age clearing the success threshold, from the MC retirement-age sweep
  const suggestedAge =
    sweep && sweep.years_to_fi != null ? startAge + sweep.years_to_fi : null;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="FIRE Number" info={A.fireMc}>
          {freedom ? (
            <>
              <Stat label="Classic 25× Expenses" value={fmtMoney(freedom.fire_number_simple)}
                sub={`${fmtMoney(freedom.annual_retirement_expenses)}/yr at retirement age`}
                info={A.fireSimple} />
              <ProgressBar fraction={freedom.fire_progress_simple ?? 0} />
              <Stat label={`MC-derived (≥${fmtPct(freedom.success_threshold, 0)} Success, Retire Today)`}
                value={fmtMoney(freedom.fire_number_mc)} info={A.fireMc} />
              <ProgressBar fraction={freedom.fire_progress_mc ?? 0} />
            </>
          ) : (
            <p className="hint">{freedomLoading ? "Computing…" : "—"}</p>
          )}
        </Section>

        <Section title="Coast FIRE" info={A.coast}>
          {freedom ? (
            <>
              <Stat label="Current Invested Total" value={fmtMoney(freedom.current_total)} />
              <Stat
                label={`Needed Today To Coast To ${s.sim.coast_target_age}`}
                value={fmtMoney(freedom.coast.coast_number)}
                sub={`assumes ${fmtPct(freedom.coast.assumed_real_return)} real return for ${freedom.coast.years_to_target} years`} />
              <ProgressBar fraction={freedom.coast.progress} />
            </>
          ) : (
            <p className="hint">{freedomLoading ? "Computing…" : "—"}</p>
          )}
        </Section>

        <Section title="Years To Retirement"
          info={"From the retirement-age sweep: the earliest age whose success probability meets your threshold and stays above it at every later age — a transient peak (e.g. just before a New Salary event) doesn't count. " + A.sweep}
          actions={
            sweep && (
              <button className="ghost" onClick={runSweep} disabled={sweeping}>
                {sweeping ? "Computing…" : "Recompute"}
              </button>
            )
          }>
          {sweep ? (
            <>
              <Stat
                label={`At ≥${fmtPct(sweep.threshold, 0)} Success`}
                value={sweep.years_to_fi != null ? `${sweep.years_to_fi} years` : "> Age 70"}
                sub={sweep.years_to_fi != null ? `Retire At ${startAge + sweep.years_to_fi}` : undefined} />
              <SweepChart sweep={sweep} axisMode={axisMode}
                birthYear={s.profile.birth_year} height={230} />
            </>
          ) : (
            <button onClick={runSweep} disabled={sweeping}>
              {sweeping ? "Computing…" : "Compute"}
            </button>
          )}
          <div className="retire-control">
            <Field label={`Planned Retirement Age: ${s.retirement_age}`}
              info="The app-wide age your salary stops and drawdown begins — it drives every projection. The sweep above shows the earliest age that clears your success threshold.">
              <div className="slider-row">
                <input type="range" min={startAge + 1} max={70} value={s.retirement_age}
                  onChange={(e) => up({ retirement_age: parseInt(e.target.value) })} />
                {sweep && (
                  sweep.years_to_fi == null ? (
                    <span className="slider-note">No age through 70 meets your threshold</span>
                  ) : s.retirement_age === suggestedAge ? (
                    <span className="slider-note ok">✓ At Suggested Age</span>
                  ) : (
                    <button type="button" className="link-action"
                      onClick={() => { if (suggestedAge != null) up({ retirement_age: suggestedAge }); }}
                      title="Jump the planned age to the earliest one that clears your success threshold">
                      Use Suggested Age <span aria-hidden="true">→</span>
                    </button>
                  )
                )}
              </div>
            </Field>
          </div>
        </Section>
      </div>

      <Section title="Liquidity: Can You Bridge To 59½?"
        info={A.accessibility + " This is the balance you could tap penalty-free in each year — a stock, not a surplus over spending. A Roth conversion doesn't add spendable income here; it relocates money into the Roth, which becomes penalty-free five years later (and at 59½ regardless). The bridge is the gap between the Retire and 59½ markers."}>
        {result ? (
          <AccessibilityChart result={result} axisMode={axisMode}
            retirementMarker={axisMode === "age"
              ? s.retirement_age
              : s.profile.birth_year + s.retirement_age}
            birthYear={s.profile.birth_year} />
        ) : (
          <p className="hint">Simulation pending…</p>
        )}
      </Section>

      <Group title="Retirement Income & Spending">
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
        <div className="group-col">
        <Section title="Withdrawal Policy"
          info={A.policy + " Two phases: before 59½, traditional and Roth earnings are penalty-locked, so the bridge runs on cash, taxable, and Roth contributions/conversions. At 59½ everything opens up — putting traditional ahead of Roth then lets the Roth keep compounding tax-free."}>
          <div className="policy-row">
            {(["order", "late_order"] as const).map((which) => {
              const list = s.withdrawal_policy[which]
                ?? (which === "order" ? DEFAULT_ORDER : DEFAULT_LATE_ORDER);
              const move = (i: number, dir: -1 | 1) => {
                const j = i + dir;
                if (j < 0 || j >= list.length) return;
                const next = [...list];
                [next[i], next[j]] = [next[j], next[i]];
                up({ withdrawal_policy: { ...s.withdrawal_policy, [which]: next } });
              };
              return (
                <div className="policy-col" key={which}>
                  <div className="policy-col-head">
                    {which === "order" ? "Before 59½" : "59½ & After"}
                  </div>
                  <ol className="policy-list">
                    {list.map((src, i) => (
                      <li key={src}>
                        {SOURCE_LABELS[src]}
                        <span>
                          <button className="ghost" disabled={i === 0}
                            onClick={() => move(i, -1)}>↑</button>
                          <button className="ghost" disabled={i === list.length - 1}
                            onClick={() => move(i, 1)}>↓</button>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="hint">
                    {which === "order"
                      ? "Trad & Roth earnings are penalty-locked here."
                      : "Trad above Roth keeps the Roth compounding tax-free."}
                  </p>
                </div>
              );
            })}
            <div className="fields">
              <Field label="Cash Buffer"
                info="The withdrawal policy never draws the cash pool below this amount (today's dollars) — it's your untouchable emergency reserve.">
                <NumberInput value={s.withdrawal_policy.cash_buffer} step={1000}
                  onChange={(v) => up({ withdrawal_policy: { ...s.withdrawal_policy, cash_buffer: v } })} />
              </Field>
              <Field label="Last Resort"
                info="If every other source is empty before 59½, tap traditional accounts early and pay the 10% penalty rather than fail the year. Withdrawals that needed this are still counted, penalty and all.">
                <input type="checkbox" checked={s.withdrawal_policy.allow_early_trad_with_penalty}
                  onChange={(e) => up({ withdrawal_policy: { ...s.withdrawal_policy, allow_early_trad_with_penalty: e.target.checked } })} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Spending Guardrails"
          info={A.guardrails + " Guardrails act only after retirement — while working, spending is funded by salary and never flexed."}>
          <div className="fields">
            <Field label="Enabled">
              <input type="checkbox" checked={s.guardrails.enabled}
                onChange={(e) => up({ guardrails: { ...s.guardrails, enabled: e.target.checked } })} />
            </Field>
            <Field label="Guard Band (± Around Initial Rate)">
              <PercentInput value={s.guardrails.band} step={5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, band: v } })} />
            </Field>
            <Field label="Cut Step">
              <PercentInput value={s.guardrails.cut} step={2.5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, cut: v } })} />
            </Field>
            <Field label="Restore Step">
              <PercentInput value={s.guardrails.boost} step={2.5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, boost: v } })} />
            </Field>
            <Field label="Floor (Min % Of Planned Discretionary)">
              <PercentInput value={s.guardrails.floor_mult} step={5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, floor_mult: v } })} />
            </Field>
          </div>
          <p className="hint">
            Cuts apply only to streams not marked Essential in the Cash Flow Expenses table.
          </p>
        </Section>
        </div>
      </Group>

      <Group title="Required Minimum Distributions">
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

      <Group title="Social Security">
        <Section title="Social Security" info={A.ss}
          actions={
            <a className="ext" href="https://www.ssa.gov/myaccount/" target="_blank"
              rel="noreferrer" title="Get your benefit estimate from your Social Security statement">
              Estimate At ssa.gov ↗
            </a>
          }>
          <div className="fields">
            <Field label="Monthly Benefit At FRA (Today's $)">
              <NumberInput value={s.social_security.monthly_at_fra} step={100}
                onChange={(v) => up({ social_security: { ...s.social_security, monthly_at_fra: v } })} />
            </Field>
            <Field label="Claiming Age (62–70)">
              <NumberInput value={s.social_security.claiming_age} step={1} min={62} max={70}
                onChange={(v) => up({ social_security: { ...s.social_security, claiming_age: v } })} />
            </Field>
            <Field label="Haircut (Trust-Fund Scenario)">
              <select value={String(s.social_security.haircut)}
                onChange={(e) => up({ social_security: { ...s.social_security, haircut: parseFloat(e.target.value) } })}>
                <option value="1">100% Of Projected</option>
                <option value="0.75">75%</option>
                <option value="0.5">50%</option>
                <option value="0.25">25%</option>
                <option value="0">0% (None)</option>
              </select>
            </Field>
          </div>
        </Section>
      </Group>
    </div>
  );
}
