import React, { useEffect, useState } from "react";
import { A } from "../assumptions";
import {
  AccessibilityChart, AccessibilityFanChart, HistogramChart, SsIncomeChart,
  SurfaceHeatmap, SweepChart, TornadoChart, WithdrawalSourceChart,
} from "../components/charts";
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
          sweeping, axisMode,
          maxspend, runMaxSpend, maxspendLoading,
          surface, runSurface, surfaceLoading,
          sensitivity, runSensitivity, sensitivityLoading,
          bridgecrash, runBridgeCrash, bridgecrashLoading } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [crashDrop, setCrashDrop] = useState(0.35);
  const [crashYears, setCrashYears] = useState(2);

  useEffect(() => {
    if (scenario && !freedom && !freedomLoading) void runFreedom();
  }, [scenario, freedom]);

  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const ss = s.spending_strategy;
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

        <Section title="Max Sustainable Spending" info={A.maxSpend}
          actions={maxspend && (
            <button className="ghost" onClick={runMaxSpend} disabled={maxspendLoading}>
              {maxspendLoading ? "Computing…" : "Recompute"}
            </button>
          )}>
          {maxspend ? (
            <Stat label={`At ≥${fmtPct(maxspend.threshold, 0)} Success`}
              value={`${fmtMoney(maxspend.max_living_annual)}/yr`}
              sub={`${maxspend.max_scale.toFixed(2)}× planned ${fmtMoney(maxspend.base_living_annual)}/yr${maxspend.capped ? " (capped at 8×)" : ""}`} />
          ) : (
            <button onClick={runMaxSpend} disabled={maxspendLoading}>
              {maxspendLoading ? "Computing…" : "Compute"}
            </button>
          )}
        </Section>

        <Section title="Headroom" info={A.headroom}>
          {result ? (
            <Stat label="Median Ending Net Worth"
              value={fmtMoney(result.fan.real.p50[result.fan.real.p50.length - 1] ?? 0)}
              sub="today's $ — unconsumed margin, not a goal" info={A.headroom} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>

        <Section title="One More Year" info={A.oneMoreYear}>
          {sweep ? (() => {
            const cur = sweep.sweep[String(s.retirement_age)];
            const next = sweep.sweep[String(s.retirement_age + 1)];
            if (cur == null || next == null)
              return <p className="hint">Planned age is outside the computed sweep range.</p>;
            return (
              <Stat label={`Work To ${s.retirement_age + 1} Instead Of ${s.retirement_age}`}
                value={`${next - cur >= 0 ? "+" : ""}${fmtPct(next - cur)} success`}
                sub={`${fmtPct(cur)} → ${fmtPct(next)}`} />
            );
          })() : (
            <p className="hint">Compute the success curve (Years To Retirement) to see what one more year buys.</p>
          )}
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

      {result && result.bridge && (
        <Section title="Bridge Confidence" info={A.bridgeConfidence}>
          {result.bridge.has_bridge ? (() => {
            const b = result.bridge;
            const pctAcc = b.at_retirement?.pct_accessible ?? 0;
            return (
              <>
                <div className="stat-grid">
                  <Stat label="Bridge Holds"
                    value={fmtPct(1 - (b.bridge_break_rate ?? 0), 0)}
                    sub="penalty-free money lasts to 59½" info={A.bridgeBreak} />
                  <Stat label="Relies On Early Penalty"
                    value={fmtPct(b.early_penalty_rate ?? 0, 0)}
                    sub={`median ${fmtMoney(b.median_penalty_real ?? 0)} when it does`}
                    info={A.bridgePenalty} />
                  <Stat label="Coverage (Median)"
                    value={`${(b.coverage_p50 ?? 0).toFixed(2)}×`}
                    sub={`worst 5%: ${(b.coverage_p5 ?? 0).toFixed(2)}×`}
                    info={A.bridgeCoverage} />
                  <Stat label="Runway"
                    value={`${Math.round(b.runway_p50 ?? 0)} yr`}
                    sub={`vs ${b.bridge_years}-yr gap · worst 5%: ${Math.round(b.runway_p5 ?? 0)} yr`}
                    info={A.bridgeCoverage} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <Stat label="Accessible At Retirement" value={fmtPct(pctAcc, 0)}
                    sub={`${fmtMoney(b.at_retirement?.accessible_real ?? 0)} reachable · ${fmtMoney(b.at_retirement?.locked_real ?? 0)} penalty-locked`}
                    info={A.bridgeSplit} />
                  <ProgressBar fraction={pctAcc} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <AccessibilityFanChart result={result} axisMode={axisMode}
                    retirementMarker={axisMode === "age"
                      ? s.retirement_age : s.profile.birth_year + s.retirement_age}
                    retirementAge={s.retirement_age}
                    birthYear={s.profile.birth_year} />
                </div>
                {b.min_accessible_real && b.min_accessible_real.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="card-head"><h3 style={{ fontSize: 13, margin: 0 }}>
                      Lowest Penalty-Free Balance During The Bridge<InfoTip text={A.bridgeMinAccessible} />
                    </h3></div>
                    <HistogramChart values={b.min_accessible_real} unit="money"
                      color="rgba(63,185,80,0.5)"
                      markers={[{ value: 0, label: "Runs Dry", color: "#f85149" }]}
                      title="" xTitle="Low-Water Mark Of Penalty-Free Assets (Today's $)" />
                  </div>
                )}
              </>
            );
          })() : (
            <p className="hint">
              No bridge to cross — your retirement age is at or past 59½, so traditional
              accounts are penalty-free from day one.
            </p>
          )}
        </Section>
      )}

      <Section title="Retire Into A Crash" info={A.bridgeCrash}>
        <div className="fields">
          <Field label="Crash Size (Stock Drop)"
            info="The real stock-market drop forced on the first years of retirement; bonds fall a third as much. Applied on the same market paths so the change is pure sequence-of-returns effect.">
            <select value={String(crashDrop)}
              onChange={(e) => setCrashDrop(parseFloat(e.target.value))}>
              <option value="0.2">−20%</option>
              <option value="0.35">−35% (2008-scale)</option>
              <option value="0.5">−50% (Depression-scale)</option>
            </select>
          </Field>
          <Field label="Duration (Years)">
            <NumberInput value={crashYears} step={1} min={1} max={5} onChange={setCrashYears} />
          </Field>
          <button onClick={() => runBridgeCrash(crashDrop, crashYears)} disabled={bridgecrashLoading}>
            {bridgecrashLoading ? "Computing…" : "Run Crash Test"}
          </button>
        </div>
        {bridgecrash && (
          bridgecrash.has_bridge ? (
            <div className="stat-grid" style={{ marginTop: 10 }}>
              <Stat label="Success: Baseline → Crash"
                value={`${fmtPct(bridgecrash.base_success, 0)} → ${fmtPct(bridgecrash.stressed_success, 0)}`}
                sub={`${bridgecrash.success_delta >= 0 ? "+" : ""}${fmtPct(bridgecrash.success_delta)} vs baseline`} />
              <Stat label="Bridge Breaks: Baseline → Crash"
                value={`${fmtPct(bridgecrash.base_bridge_break_rate, 0)} → ${fmtPct(bridgecrash.stressed_bridge_break_rate, 0)}`}
                sub={`a ${fmtPct(bridgecrash.drop, 0)} drop over ${bridgecrash.years} yr at age ${bridgecrash.retirement_age}`} />
              <Stat label="Early-Penalty Reliance: Baseline → Crash"
                value={`${fmtPct(bridgecrash.base_early_penalty_rate, 0)} → ${fmtPct(bridgecrash.stressed_early_penalty_rate, 0)}`} />
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 10 }}>
              No bridge to stress — retirement is at or past 59½.
            </p>
          )
        )}
      </Section>

      <Section title="When & How Much: Success Surface" info={A.surface}
        actions={surface && (
          <button className="ghost" onClick={runSurface} disabled={surfaceLoading}>
            {surfaceLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        {surface ? (
          <SurfaceHeatmap data={surface} axisMode={axisMode} birthYear={s.profile.birth_year}
            currentAge={s.retirement_age} />
        ) : (
          <button onClick={runSurface} disabled={surfaceLoading}>
            {surfaceLoading ? "Computing…" : "Compute Surface"}
          </button>
        )}
      </Section>

      <Section title="What Moves The Needle" info={A.tornado}
        actions={sensitivity && (
          <button className="ghost" onClick={runSensitivity} disabled={sensitivityLoading}>
            {sensitivityLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        {sensitivity ? (
          <TornadoChart data={sensitivity} />
        ) : (
          <button onClick={runSensitivity} disabled={sensitivityLoading}>
            {sensitivityLoading ? "Computing…" : "Compute Sensitivity"}
          </button>
        )}
      </Section>

      <Group title="Withdrawal & Spending Policy">
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
          <div style={{ marginTop: 8 }}>
            <div className="card-head"><h3 style={{ fontSize: 13, margin: 0 }}>
              Spending Funded By Source<InfoTip text={A.withdrawalSource} />
            </h3></div>
            {result ? (
              <WithdrawalSourceChart result={result} axisMode={axisMode} />
            ) : (
              <p className="hint">Simulation pending…</p>
            )}
          </div>
        </Section>

        <Section title="Spending Strategy" info={A.spendingStrategy}>
          <div className="fields">
            <Field label="Strategy"
              info="How much to spend each retirement year — separate from the Withdrawal Policy above, which only chooses which account to tap.">
              <select value={ss.kind}
                onChange={(e) => up({ spending_strategy: { ...ss, kind: e.target.value as any } })}>
                <option value="constant_dollar">Constant Dollar (Plan + Guardrails)</option>
                <option value="constant_pct">Constant % Of Portfolio</option>
                <option value="vpw">Variable % (VPW — Rises With Age)</option>
                <option value="floor_ceiling">Floor &amp; Ceiling (Bounded %)</option>
              </select>
            </Field>
            {(ss.kind === "constant_pct" || ss.kind === "floor_ceiling") && (
              <Field label="Withdrawal Rate (% Of Portfolio)">
                <PercentInput value={ss.rate} step={0.25}
                  onChange={(v) => up({ spending_strategy: { ...ss, rate: v } })} />
              </Field>
            )}
            {ss.kind === "vpw" && (
              <Field label="VPW Assumed Real Return"
                info="The real return baked into the annuity payout factor. Higher → larger early withdrawals; the rate still rises with age and spends the balance down by the horizon.">
                <PercentInput value={ss.vpw_real_return} step={0.25}
                  onChange={(v) => up({ spending_strategy: { ...ss, vpw_real_return: v } })} />
              </Field>
            )}
            {ss.kind === "floor_ceiling" && (
              <>
                <Field label="Floor (% Of Plan Discretionary)">
                  <PercentInput value={ss.floor_mult} step={5}
                    onChange={(v) => up({ spending_strategy: { ...ss, floor_mult: v } })} />
                </Field>
                <Field label="Ceiling (% Of Plan Discretionary)">
                  <PercentInput value={ss.ceiling_mult} step={5}
                    onChange={(v) => up({ spending_strategy: { ...ss, ceiling_mult: v } })} />
                </Field>
              </>
            )}
          </div>

          {ss.kind === "constant_dollar" ? (
            <>
              <div className="fields">
                <Field label="Guardrails Enabled"
                  info={A.guardrails + " Guardrails act only after retirement — while working, spending is funded by salary and never flexed."}>
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
                <Field label="Ceiling (Max % Of Planned Discretionary)"
                  info="Cap on restored spending. Default 100% = never spend above plan. Raise it above 100% to let good markets fund extra lifestyle — directly relevant with no bequest goal, where leftover money is unconsumed margin.">
                  <PercentInput value={s.guardrails.cap_mult} step={5}
                    onChange={(v) => up({ guardrails: { ...s.guardrails, cap_mult: v } })} />
                </Field>
              </div>
              <p className="hint">
                Cuts apply only to streams not marked Essential in the Cash Flow Expenses table.
              </p>
            </>
          ) : (
            <p className="hint">
              This portfolio-percentage strategy replaces the guardrails: discretionary
              spending tracks your balance each year (essentials — medical and loan
              payments — are always funded first). See the realized path on the Risk tab's
              Spending Level chart.
            </p>
          )}
        </Section>
        </div>
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
          {result && s.social_security.monthly_at_fra > 0 && (
            <SsIncomeChart result={result} axisMode={axisMode}
              claimingAge={s.social_security.claiming_age} birthYear={s.profile.birth_year} />
          )}
        </Section>
      </Group>
    </div>
  );
}
