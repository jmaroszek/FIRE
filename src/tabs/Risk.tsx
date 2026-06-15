import React, { useEffect, useState } from "react";
import { A } from "../assumptions";
import {
  AccessibilityChart, AccessibilityFanChart, FrontierChart, FulfillmentChart,
  HistogramChart, RuinAgeChart, SpendingDepthChart, SurvivalChart, TornadoChart,
} from "../components/charts";
import {
  Field, InfoTip, NumberInput, PercentInput, Section, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { useStore } from "../store";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function Risk() {
  const { scenario, result, display, axisMode,
          freedom, freedomLoading, runFreedom, sweep, sweeping, runSweep,
          sensitivity, sensitivityLoading, runSensitivity,
          stress, stressLoading, runStress,
          bridgecrash, bridgecrashLoading, runBridgeCrash } = useStore();
  const startAge = scenario ? scenario.sim.start_year - scenario.profile.birth_year : 40;
  const midCareer = scenario ? Math.round((startAge + scenario.retirement_age) / 2) : startAge;
  const [shockAge, setShockAge] = useState(midCareer);
  const [shockDur, setShockDur] = useState(3);
  const [crashDrop, setCrashDrop] = useState(0.35);
  const [crashYears, setCrashYears] = useState(2);
  const [goGoEnd, setGoGoEnd] = useState(75);
  const [enjoyFloor, setEnjoyFloor] = useState(0.3);

  // Risk hosts the Frontier (sweep) and Headroom-style estate read (freedom);
  // populate both on a cold visit so the hero isn't empty.
  useEffect(() => { if (scenario && !freedom && !freedomLoading) void runFreedom(); }, [scenario, freedom]);
  useEffect(() => { if (scenario && !sweep && !sweeping) void runSweep(); }, [scenario, sweep]);

  if (!scenario) return null;
  if (!result) {
    return (
      <div className="stack">
        <Section title="Risk & Robustness"><p className="hint">Simulation pending…</p></Section>
      </div>
    );
  }
  const s = scenario;
  const ci = result.success_ci;
  const endingVals = result.ending_balance[display];
  const medEnding = median(endingVals);
  const medDrawdown = median(result.max_drawdown);
  const medYearsCut = median(result.spending_distribution.years_in_cut);
  const dollars = display === "real" ? "Today's" : "Nominal";
  const retMarker = axisMode === "age" ? s.retirement_age : s.profile.birth_year + s.retirement_age;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Plan Success" info={A.successRate}>
          <Stat label="Success Probability" value={fmtPct(ci.rate)}
            sub={`Retire at ${s.retirement_age}, horizon ${s.profile.horizon_age}`} />
          <Stat label="Monte Carlo 95% Interval" value={`${fmtPct(ci.lo)} – ${fmtPct(ci.hi)}`}
            sub={`Sampling error across ${ci.n_paths.toLocaleString()} paths`} info={A.successCi} />
        </Section>
        <Section title="Outcome Snapshot">
          <Stat label="Median Ending Net Worth" value={fmtMoney(medEnding)}
            sub={`${dollars} $`} info={A.endingBalance} />
          <Stat label="Median Maximum Drawdown" value={fmtPct(medDrawdown)} info={A.drawdown} />
          <Stat label="Median Years In A Guardrail Cut"
            value={s.guardrails.enabled ? String(medYearsCut) : "—"}
            sub={s.guardrails.enabled ? undefined : "guardrails off"} info={A.spendingDelivered} />
        </Section>
      </div>

      <Section title="Over-Saving Frontier: When To Pull The Trigger" info={A.frontier}
        actions={sweep && (
          <button className="ghost" onClick={runSweep} disabled={sweeping}>
            {sweeping ? "Computing…" : "Recompute"}
          </button>
        )}>
        {sweep ? (
          <FrontierChart sweep={sweep} axisMode={axisMode} birthYear={s.profile.birth_year}
            retirementMarker={retMarker}
            annualExpenses={freedom?.annual_retirement_expenses} />
        ) : (
          <button onClick={runSweep} disabled={sweeping}>
            {sweeping ? "Computing…" : "Compute Frontier"}
          </button>
        )}
      </Section>

      <Section title="Spending vs Ability To Enjoy It" info={A.fulfillment}>
        {(() => {
          const ages = result.ages;
          const spend = result.expenses_median_real;
          const total = spend.reduce((a, b) => a + b, 0);
          const shareWhere = (pred: (age: number) => boolean) =>
            total > 0 ? spend.reduce((acc, v, i) => acc + (pred(ages[i]) ? v : 0), 0) / total : 0;
          const goGo = shareWhere((a) => a <= goGoEnd);
          const slowGo = shareWhere((a) => a > goGoEnd && a <= 85);
          const noGo = shareWhere((a) => a > 85);
          return (
            <>
              <div className="fields">
                <Field label="Go-Go Years End At Age"
                  info="Through this age a dollar buys full enjoyment; after it, enjoyment tapers as health and energy fade.">
                  <NumberInput value={goGoEnd} step={1} min={s.retirement_age} max={90} onChange={setGoGoEnd} />
                </Field>
                <Field label="Late-Life Enjoyment Floor"
                  info="How much a dollar is still worth from age 90 on, relative to the go-go years. Perkins' rough default is 30%.">
                  <PercentInput value={enjoyFloor} step={5} onChange={setEnjoyFloor} />
                </Field>
              </div>
              <div className="stat-grid">
                <Stat label="Spent In Go-Go Years" value={fmtPct(goGo, 0)} sub={`through age ${goGoEnd}`} info={A.fulfillment} />
                <Stat label="Slow-Go" value={fmtPct(slowGo, 0)} sub={`${goGoEnd + 1}–85`} />
                <Stat label="No-Go" value={fmtPct(noGo, 0)} sub="86+" />
              </div>
              <FulfillmentChart result={result} axisMode={axisMode}
                retirementAge={s.retirement_age} birthYear={s.profile.birth_year}
                goGoEnd={goGoEnd} floor={enjoyFloor} />
            </>
          );
        })()}
      </Section>

      <Section title="Ending Net Worth Distribution" info={A.endingBalance}>
        <HistogramChart values={endingVals} unit="money" uirevision={display}
          title="" xTitle={`Net Worth At Age ${s.profile.horizon_age} (${dollars} $)`} />
      </Section>

      <Section title="Survival Curve" info={A.survival}>
        <SurvivalChart result={result} axisMode={axisMode}
          retirementAge={s.retirement_age} threshold={s.sim.success_threshold}
          birthYear={s.profile.birth_year} />
      </Section>

      <Section title="When Plans Fail" info={A.ruinAge}>
        <RuinAgeChart data={result.age_at_ruin} />
      </Section>

      <Section title="Failure Severity" info={A.failureSeverity}>
        {result.failure_magnitude.failing_paths > 0 ? (
          <div className="stat-grid">
            <Stat label="Paths That Run Short"
              value={`${result.failure_magnitude.failing_paths} of ${result.failure_magnitude.total_paths}`} />
            <Stat label="Median Total Shortfall"
              value={fmtMoney(result.failure_magnitude.median_total_shortfall_real)}
              sub="today's $, failing paths only" info={A.failureSeverity} />
            <Stat label="Median Years Short" value={String(result.failure_magnitude.median_years_short)}
              sub={`worst 10%: ${fmtMoney(result.failure_magnitude.p90_total_shortfall_real)}`} />
          </div>
        ) : <p className="hint">No path ran short — there is no shortfall to size.</p>}
      </Section>

      <Section title="Maximum Drawdown (Real)" info={A.drawdown}>
        <HistogramChart values={result.max_drawdown} unit="percent" color="rgba(210,153,34,0.55)"
          title="" xTitle="Deepest Peak-To-Trough Fall In Real Net Worth" />
      </Section>

      <Section title="Realized Spending Level" info={A.spendingDepth}>
        <SpendingDepthChart result={result} axisMode={axisMode} retirementAge={s.retirement_age}
          enabled={s.spending_strategy.kind !== "constant_dollar" || s.guardrails.enabled}
          floor={s.spending_strategy.kind === "floor_ceiling" ? s.spending_strategy.floor_mult
            : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.floor_mult : 0}
          cap={s.spending_strategy.kind === "floor_ceiling" ? s.spending_strategy.ceiling_mult
            : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.cap_mult : 0}
          birthYear={s.profile.birth_year} />
      </Section>

      <Section title="Liquidity: Penalty-Free Assets By Source"
        info={A.accessibility + " The balance you could tap penalty-free each year — a stock, not a surplus. The bridge is the gap between Retire and 60."}>
        <AccessibilityChart result={result} axisMode={axisMode}
          retirementMarker={retMarker} birthYear={s.profile.birth_year} />
      </Section>

      {result.bridge && (
        <Section title="Bridge Confidence: Can You Reach 59½?" info={A.bridgeConfidence}>
          {result.bridge.has_bridge ? (() => {
            const b = result.bridge;
            const pctAcc = b.at_retirement?.pct_accessible ?? 0;
            return (
              <>
                <div className="stat-grid">
                  <Stat label="Bridge Holds" value={fmtPct(1 - (b.bridge_break_rate ?? 0), 0)}
                    sub="penalty-free money lasts to 59½ (no early-penalty raid)" info={A.bridgeBreak} />
                  <Stat label="Coverage (Median)" value={`${(b.coverage_p50 ?? 0).toFixed(2)}×`}
                    sub={`worst 5%: ${(b.coverage_p5 ?? 0).toFixed(2)}×`} info={A.bridgeCoverage} />
                  <Stat label="Runway" value={`${Math.round(b.runway_p50 ?? 0)} yr`}
                    sub={`vs ${b.bridge_years}-yr gap · worst 5%: ${Math.round(b.runway_p5 ?? 0)} yr`}
                    info={A.bridgeCoverage} />
                  <Stat label="Accessible At Retirement" value={fmtPct(pctAcc, 0)}
                    sub={`${fmtMoney(b.at_retirement?.accessible_real ?? 0)} reachable · ${fmtMoney(b.at_retirement?.locked_real ?? 0)} locked`}
                    info={A.bridgeSplit} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <AccessibilityFanChart result={result} axisMode={axisMode}
                    retirementMarker={retMarker} retirementAge={s.retirement_age}
                    birthYear={s.profile.birth_year} />
                </div>
                {b.min_accessible_real && b.min_accessible_real.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="card-head"><h3 style={{ fontSize: 13, margin: 0 }}>
                      Lowest Penalty-Free Balance During The Bridge<InfoTip text={A.bridgeMinAccessible} />
                    </h3></div>
                    <HistogramChart values={b.min_accessible_real} unit="money"
                      color="rgba(63,185,80,0.5)" title=""
                      xTitle="Low-Water Mark Of Penalty-Free Assets (Today's $)" />
                  </div>
                )}
                <div className="card-head" style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 13, margin: 0 }}>Retire Into A Crash</h3>
                </div>
                <div className="fields">
                  <Field label="Crash Size (Stock Drop)">
                    <select value={String(crashDrop)} onChange={(e) => setCrashDrop(parseFloat(e.target.value))}>
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
                {bridgecrash && bridgecrash.has_bridge && (
                  <div className="stat-grid" style={{ marginTop: 10 }}>
                    <Stat label="Success: Baseline → Crash"
                      value={`${fmtPct(bridgecrash.base_success, 0)} → ${fmtPct(bridgecrash.stressed_success, 0)}`}
                      sub={`${bridgecrash.success_delta >= 0 ? "+" : ""}${fmtPct(bridgecrash.success_delta)} vs baseline`} />
                    <Stat label="Bridge Breaks: Baseline → Crash"
                      value={`${fmtPct(bridgecrash.base_bridge_break_rate, 0)} → ${fmtPct(bridgecrash.stressed_bridge_break_rate, 0)}`}
                      sub={`a ${fmtPct(bridgecrash.drop, 0)} drop over ${bridgecrash.years} yr at age ${bridgecrash.retirement_age}`} />
                  </div>
                )}
              </>
            );
          })() : (
            <p className="hint">No bridge to cross — your retirement age is at or past 59½.</p>
          )}
        </Section>
      )}

      <Section title="What Moves The Needle" info={A.tornado}
        actions={sensitivity && (
          <button className="ghost" onClick={runSensitivity} disabled={sensitivityLoading}>
            {sensitivityLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        {sensitivity ? <TornadoChart data={sensitivity} />
          : <button onClick={runSensitivity} disabled={sensitivityLoading}>
              {sensitivityLoading ? "Computing…" : "Compute Sensitivity"}
            </button>}
      </Section>

      <Section title="Income Shock Stress Test" info={A.stressTest}>
        <div className="fields">
          <Field label="Shock Starts At Age"
            info="The age your wages drop to zero. Most meaningful before your retirement age.">
            <NumberInput value={shockAge} step={1} min={startAge} max={s.retirement_age} onChange={setShockAge} />
          </Field>
          <Field label="Duration (Years)">
            <NumberInput value={shockDur} step={1} min={1} max={20} onChange={setShockDur} />
          </Field>
          <button onClick={() => runStress(shockAge, shockDur)} disabled={stressLoading}>
            {stressLoading ? "Computing…" : "Run Stress Test"}
          </button>
        </div>
        {stress && (
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <Stat label="Baseline Success" value={fmtPct(stress.base_success)} />
            <Stat label={`After A ${stress.duration}-Year Shock At Age ${stress.shock_age}`}
              value={fmtPct(stress.stressed_success)}
              sub={`${stress.delta >= 0 ? "+" : ""}${fmtPct(stress.delta)} vs baseline`} />
          </div>
        )}
      </Section>
    </div>
  );
}
