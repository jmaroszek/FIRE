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
  const startAge = s.sim.start_year - s.profile.birth_year;

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
          <Field label={`Planned Retirement Age: ${s.retirement_age}`}
            info="The app-wide age your salary stops and drawdown begins — it drives every projection. The sweep above shows the earliest age that clears your success threshold.">
            <input type="range" min={startAge + 1} max={70} value={s.retirement_age}
              onChange={(e) => up({ retirement_age: parseInt(e.target.value) })} />
          </Field>
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
              <select value={s.conversion_rule.kind}
                onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, kind: e.target.value as any } })}>
                <option value="none">None</option>
                <option value="fill_bracket">Fill To Bracket Top</option>
                <option value="fixed">Fixed $ / Yr</option>
              </select>
            </Field>
            {s.conversion_rule.kind === "fill_bracket" && (
              <Field label="Bracket Top">
                <select value={s.conversion_rule.bracket_top}
                  onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, bracket_top: e.target.value as any } })}>
                  <option value="std_deduction">Std Deduction (0%)</option>
                  <option value="10">10% Top</option>
                  <option value="12">12% Top</option>
                  <option value="22">22% Top</option>
                </select>
              </Field>
            )}
            {s.conversion_rule.kind === "fixed" && (
              <Field label="Annual Amount">
                <NumberInput value={s.conversion_rule.annual_amount} step={1000}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, annual_amount: v } })} />
              </Field>
            )}
            <Field label="From / Until Age"
              info="Defaults: start at retirement; stop at 58, the last rung that matters — a conversion at 55 or later only finishes its 5-year seasoning after you're 59½, when traditional money is penalty-free anyway.">
              <span className="pair agecell">
                <NumberInput value={s.conversion_rule.start_age ?? s.retirement_age} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, start_age: v } })} />
                –
                <NumberInput value={s.conversion_rule.end_age ?? 58} step={1}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, end_age: v } })} />
              </span>
            </Field>
          </div>
          {result && result.ladder_schedule.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th><th>Age</th><th>Convert (Today's $)</th>
                  <th>Penalty-Free In</th>
                  <th>Traditional Left<InfoTip text="Median traditional (IRA + rolled-over 401k) balance remaining after that year's conversion and growth, in today's dollars." /></th>
                </tr>
              </thead>
              <tbody>
                {result.ladder_schedule.map((r) => (
                  <tr key={r.year}>
                    <td>{r.year}</td>
                    <td>{r.age}</td>
                    <td>{fmtMoney(r.amount_real)}</td>
                    <td>{r.matures}</td>
                    <td>{fmtMoney(r.trad_remaining_real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              No conversions in the median path. Pick a strategy above to build
              penalty-free income for the bridge years.
            </p>
          )}
        </Section>
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
      </Group>
    </div>
  );
}
