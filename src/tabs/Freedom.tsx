import React, { useEffect, useState } from "react";
import { A } from "../assumptions";
import {
  AccessibilityFanChart, FrontierChart, FulfillmentChart, HistogramChart, RuinAgeChart,
  SpendingDepthChart, SurfaceHeatmap, SurvivalChart, SweepGainChart, TornadoChart,
} from "../components/charts";
import {
  Field, HeroRow, HeroStat, InfoTip, NumberInput, PercentInput, ProgressBar, Section, SectionNav, Stat,
  fmtMoney, fmtPct,
} from "../components/ui";
import { useShallow } from "zustand/react/shallow";
import { niceStep, percentile } from "../math";
import { PENALTY_FREE_AGE } from "../constants";
import { useStore } from "../store";
import type { Scenario } from "../types";

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

export default function Freedom() {
  const { scenario, result, axisMode,
          freedom, freedomLoading, runFreedom,
          sweep, sweeping, runSweep,
          surface, surfaceLoading, runSurface,
          sensitivity, sensitivityLoading, runSensitivity,
          bridgecrash, bridgecrashLoading, runBridgeCrash } = useStore(useShallow((s) => ({
    scenario: s.scenario, result: s.result, axisMode: s.axisMode,
    freedom: s.freedom, freedomLoading: s.freedomLoading, runFreedom: s.runFreedom,
    sweep: s.sweep, sweeping: s.sweeping, runSweep: s.runSweep,
    surface: s.surface, surfaceLoading: s.surfaceLoading, runSurface: s.runSurface,
    sensitivity: s.sensitivity, sensitivityLoading: s.sensitivityLoading, runSensitivity: s.runSensitivity,
    bridgecrash: s.bridgecrash, bridgecrashLoading: s.bridgecrashLoading, runBridgeCrash: s.runBridgeCrash,
  })));
  const setScenario = useStore((s) => s.setScenario);
  const [goGoEnd, setGoGoEnd] = useState(75);
  const [enjoyFloor, setEnjoyFloor] = useState(0.3);
  const [crashDrop, setCrashDrop] = useState(0.35);
  const [crashYears, setCrashYears] = useState(2);

  // This tab owns the freedom bundle, the sweep, the sensitivity tornado and the
  // success surface; populate them all on a cold visit. We fire them independently
  // rather than chaining: each endpoint is a sync FastAPI handler that runs on its
  // own threadpool thread, and the numpy-heavy Monte Carlo releases the GIL, so the
  // requests genuinely overlap. Chaining would only add idle round-trips. Each tile
  // shows its own spinner until its result lands.
  useEffect(() => { if (scenario && !freedom && !freedomLoading) void runFreedom(); }, [scenario, freedom]);
  useEffect(() => { if (scenario && !sweep && !sweeping) void runSweep(); }, [scenario, sweep]);
  useEffect(() => { if (scenario && !sensitivity && !sensitivityLoading) void runSensitivity(); }, [scenario, sensitivity]);
  useEffect(() => { if (scenario && !surface && !surfaceLoading) void runSurface(); }, [scenario, surface]);

  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;
  const suggestedAge = sweep && sweep.years_to_fi != null ? startAge + sweep.years_to_fi : null;
  const retMarker = axisMode === "age" ? s.retirement_age : s.profile.birth_year + s.retirement_age;
  const lastReal = result?.fan.real.p50[result.fan.real.p50.length - 1] ?? 0;
  // Portfolio growth multiple (oversaving): median ending net worth ÷ median net
  // worth at the retirement year. fan.real.p50 carries a leading "today" point, so
  // age ages[k] sits at fan index k+1. Above 1× means the portfolio outgrew your
  // spending — you lived on less than it produced.
  const retIdx = result ? result.ages.findIndex((a) => a >= s.retirement_age) : -1;
  const nwAtRetirement = result && retIdx >= 0 ? (result.fan.real.p50[retIdx + 1] ?? 0) : 0;
  const growthMultiple = nwAtRetirement > 0 ? lastReal / nwAtRetirement : 0;
  // Retirement-bridge headline data (retire → 59½).
  const bridge = result?.bridge;
  const hasBridge = !!bridge?.has_bridge;
  // Bridge draw rate (undersaving): the share of penalty-free ACCESSIBLE money
  // drawn each year over the bridge (retirement → 59½, before locked accounts
  // open), averaged across those years and capped at 100%/yr so the year the
  // bridge fund is intentionally drained to ~0 can't explode the mean. High = the
  // liquid runway is strained. accessibility_fan is an end-of-year stock, so the
  // balance available to fund year k is the prior year-end value. null = no bridge.
  const bridgeDrawRate = (() => {
    if (!result) return null;
    const w = result.withdrawals_real ?? {};
    const acc = result.accessibility_fan?.p50;
    if (!acc) return null;
    let sum = 0, n = 0;
    for (let k = 0; k < result.ages.length; k++) {
      const age = result.ages[k];
      if (age < s.retirement_age || age >= PENALTY_FREE_AGE) continue;
      const draw = Object.values(w).reduce((a, arr) => a + (arr?.[k] ?? 0), 0);
      const bal = acc[k > 0 ? k - 1 : 0] ?? 0;
      if (bal > 0) { sum += Math.min(draw / bal, 1); n++; }
    }
    return n > 0 ? sum / n : null;
  })();

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "freedom-success", label: "Overall Success" },
        { id: "freedom-under", label: "Undersaving" },
        { id: "freedom-bridge", label: "Retirement Bridge" },
        { id: "freedom-over", label: "Oversaving" },
      ]} />

      {/* ───────────── OVERALL SUCCESS ───────────── */}
      <Head id="freedom-success">Overall Success</Head>
      <div className="stat-grid">
        <Section title="Coast FIRE" info={A.coast}>
          {freedom ? (
            <>
              <Stat label="Current Invested Total" value={fmtMoney(freedom.current_total)} />
              <Stat label={`Needed Today To Coast To ${s.sim.coast_target_age}`}
                value={fmtMoney(freedom.coast.coast_number)}
                sub={`assumes ${fmtPct(freedom.coast.assumed_real_return)} real return for ${freedom.coast.years_to_target} years`} />
              <ProgressBar fraction={freedom.coast.progress} />
            </>
          ) : freedomLoading
            ? <div className="tile-loading"><span className="spinner" />Computing…</div>
            : <p className="hint">—</p>}
        </Section>

        <Section title="FIRE Number" info={A.fireMc}>
          {freedom ? (
            <>
              <Stat label="Classic 25× Expenses" value={fmtMoney(freedom.fire_number_simple)}
                sub={`${fmtMoney(freedom.annual_retirement_expenses)}/yr at retirement age`}
                info={A.fireSimple} />
              <ProgressBar fraction={freedom.fire_progress_simple ?? 0} />
              <Stat label={`MC-derived (≥${fmtPct(freedom.success_threshold, 0)} Success, Retire Today)`}
                value={fmtMoney(freedom.fire_number_mc)} />
              <ProgressBar fraction={freedom.fire_progress_mc ?? 0} />
            </>
          ) : freedomLoading
            ? <div className="tile-loading"><span className="spinner" />Computing…</div>
            : <p className="hint">—</p>}
        </Section>

        <Section title="Plan Success" info={A.successRate}>
          {result ? (
            <>
              <Stat label="Success Probability" value={fmtPct(result.success_ci.rate)}
                sub={`Retire at ${s.retirement_age}, horizon ${s.profile.horizon_age}`} />
              <Stat label="Monte Carlo 95% Interval"
                value={`${fmtPct(result.success_ci.lo)} – ${fmtPct(result.success_ci.hi)}`}
                sub={`Sampling error across ${result.success_ci.n_paths.toLocaleString()} paths`} info={A.successCi} />
            </>
          ) : <p className="hint">Simulation pending…</p>}
        </Section>
      </div>

      <Section title="When Can I Retire?"
        info={"Success probability by retirement age, with the gain each extra year buys. The earliest age clearing your success threshold (and staying above it) is the suggested age. " + A.sweep}
        actions={sweep && (
          <button className="ghost" onClick={runSweep} disabled={sweeping}>
            {sweeping ? "Computing…" : "Recompute"}
          </button>
        )}>
        {sweep ? (
          <SweepGainChart sweep={sweep} axisMode={axisMode} birthYear={s.profile.birth_year} />
        ) : sweeping ? (
          <div className="tile-loading"><span className="spinner" />Computing…</div>
        ) : (
          <button onClick={runSweep}>Compute</button>
        )}
        <div className="retire-control">
          <Field label={`Planned Retirement Age: ${s.retirement_age}`}
            info="The app-wide age your salary stops and drawdown begins — it drives every projection.">
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

      <div className="grid2">
        <Section title="Sensitivity Analysis" info={A.tornado}
          actions={sensitivity && (
            <button className="ghost" onClick={runSensitivity} disabled={sensitivityLoading}>
              {sensitivityLoading ? "Computing…" : "Recompute"}
            </button>
          )}>
          {sensitivity ? <TornadoChart data={sensitivity} height={360} />
            : sensitivityLoading
              ? <div className="tile-loading"><span className="spinner" />Computing…</div>
              : <button onClick={runSensitivity}>Compute Sensitivity</button>}
        </Section>

        <Section title="Success Surface" info={A.surface}
          actions={surface && (
            <button className="ghost" onClick={runSurface} disabled={surfaceLoading}>
              {surfaceLoading ? "Computing…" : "Recompute"}
            </button>
          )}>
          {surface ? (
            <SurfaceHeatmap data={surface} axisMode={axisMode} birthYear={s.profile.birth_year}
              currentAge={s.retirement_age} height={360} />
          ) : surfaceLoading ? (
            <div className="tile-loading"><span className="spinner" />Computing…</div>
          ) : (
            <button onClick={runSurface}>Compute Surface</button>
          )}
        </Section>
      </div>

      {/* ───────────── UNDERSAVING ───────────── */}
      <Head id="freedom-under">Undersaving — Could It Fall Short?</Head>
      {result && (
        <>
          {result.failure_magnitude.failing_paths > 0 ? (
            <div className="stat-grid">
              <Section title="Paths That Run Short" info={A.failureSeverity}>
                <Stat label="Of All Monte Carlo Paths"
                  value={fmtPct(result.failure_magnitude.failing_paths / result.failure_magnitude.total_paths, 0)}
                  sub={`${result.failure_magnitude.failing_paths} of ${result.failure_magnitude.total_paths} paths`} />
              </Section>
              <Section title="Median Shortfall" info={A.failureSeverity}>
                <Stat label="Among Failing Paths (Today's $)"
                  value={fmtMoney(result.failure_magnitude.median_total_shortfall_real)}
                  sub={`worst 10%: ${fmtMoney(result.failure_magnitude.p90_total_shortfall_real)}`} />
              </Section>
              <Section title="Bridge Draw Rate" info={A.bridgeDrawRate}>
                {bridgeDrawRate != null ? (
                  <Stat label="Draw ÷ Accessible, Avg Over The Bridge"
                    value={fmtPct(bridgeDrawRate, 0)}
                    sub="penalty-free money, retire→59½; high = strained" />
                ) : <p className="hint">No bridge — retiring at/after 59½.</p>}
              </Section>
            </div>
          ) : (
            <Section title="Failure Severity" info={A.failureSeverity}>
              <p className="hint">No path ran short — there is no shortfall to size.</p>
            </Section>
          )}

          <div className="stat-grid">
            <Section title="Survival Curve" info={A.survival}>
              <SurvivalChart result={result} axisMode={axisMode}
                retirementAge={s.retirement_age} threshold={s.sim.success_threshold}
                birthYear={s.profile.birth_year} />
            </Section>
            <Section title="When Plans Fail" info={A.ruinAge}>
              <RuinAgeChart data={result.age_at_ruin} />
            </Section>
          </div>

          {(s.spending_strategy.kind !== "constant_dollar" || s.guardrails.enabled) && (
            <Section title="Realized Spending" info={A.spendingDepth}>
              <SpendingDepthChart result={result} axisMode={axisMode} retirementAge={s.retirement_age}
                enabled={s.spending_strategy.kind !== "constant_dollar" || s.guardrails.enabled}
                floor={s.spending_strategy.kind === "percent_portfolio" && s.spending_strategy.bounded ? s.spending_strategy.floor_mult
                  : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.floor_mult : 0}
                cap={s.spending_strategy.kind === "percent_portfolio" && s.spending_strategy.bounded ? s.spending_strategy.ceiling_mult
                  : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.cap_mult : 0}
                birthYear={s.profile.birth_year} />
            </Section>
          )}

          <p className="hint" style={{ maxWidth: "none" }}>
            The steepest part of the survival curve is the decade right after you retire, because
            several forces pile up there at once. A market drop the moment you stop earning forces you
            to sell depressed assets you can't buy back — sequence-of-returns risk — and there is no
            paycheck to cushion the blow, Social Security hasn't started, and the penalty-free bridge
            is at its longest and most strained. Clear that first decade with your assets intact and
            the hazard fades quickly, which is exactly why the curve drops early and then levels off.
            The levers that help most all soften those early years: a cash buffer or rising-equity
            glidepath (Accounts), flexible spending through guardrails or VPW (Cash Flow), a larger
            liquid bridge, working a year or two longer, or a little part-time income early on.
          </p>
        </>
      )}

      {/* ───────────── RETIREMENT BRIDGE ───────────── */}
      <Head id="freedom-bridge">Retirement Bridge — Reaching 59½</Head>
      {!result ? (
        <p className="hint">Simulation pending…</p>
      ) : !hasBridge || !bridge ? (
        <Section title="Bridge Confidence: Can You Reach 59½?" info={A.bridgeConfidence}>
          <p className="hint">No bridge to cross — your retirement age is at or past 59½.</p>
        </Section>
      ) : (
        <>
          <HeroRow>
            <HeroStat tone="green" label="Bridge Holds" value={fmtPct(1 - (bridge.bridge_break_rate ?? 0), 0)}
              sub="penalty-free money lasts to 59½ (no early-penalty raid)" info={A.bridgeHolds} />
            <HeroStat label="Liquid Needed" value={fmtMoney(bridge.bridge_funding_total_real ?? 0)}
              sub={`first ${bridge.bridge_funding_years} retirement years · spending + ${fmtMoney(bridge.bridge_funding_tax_real ?? 0)} tax`}
              info={A.bridgeFunding} />
            <HeroStat tone="amber" label="Bridge Coverage" value={`${(bridge.coverage_p50 ?? 0).toFixed(1)}×`}
              sub={`covers ~${Math.round(bridge.runway_p50 ?? 0)} yr of spending · worst 5%: ${(bridge.coverage_p5 ?? 0).toFixed(1)}×`}
              info={A.bridgeCoverage} />
          </HeroRow>

          <Section title="Bridge Confidence: Can You Reach 59½?" info={A.bridgeConfidence}>
            <AccessibilityFanChart result={result} axisMode={axisMode}
              retirementMarker={retMarker} retirementAge={s.retirement_age}
              birthYear={s.profile.birth_year} />
            {bridge.min_accessible_real && bridge.min_accessible_real.length > 0 && (() => {
              const sorted = [...bridge.min_accessible_real].sort((a, b) => a - b);
              const n = sorted.length;
              const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
              return (
                <div style={{ marginTop: 8 }}>
                  <div className="card-head"><h3 style={{ fontSize: 13, margin: 0 }}>
                    Lowest Penalty-Free Balance During The Bridge<InfoTip text={A.bridgeMinAccessible} />
                  </h3></div>
                  <HistogramChart values={bridge.min_accessible_real} unit="money"
                    color="rgba(63,185,80,0.5)" title=""
                    markers={[{ value: med, label: `Median ${fmtMoney(med)}` }]}
                    bins={{ start: 0, size: 50000, end: 500000 }} clampOverflow
                    xTitle="Low-Water Mark Of Penalty-Free Assets (Today's $, 500k+ grouped)" />
                </div>
              );
            })()}
          </Section>

          <Section title="Retire Into A Crash" info={A.bridgeCrash}>
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
                <Stat label="Overall Success: Baseline → Crash"
                  value={`${fmtPct(bridgecrash.base_success, 0)} → ${fmtPct(bridgecrash.stressed_success, 0)}`}
                  sub={`${bridgecrash.success_delta >= 0 ? "+" : ""}${fmtPct(bridgecrash.success_delta)} vs baseline · a ${fmtPct(bridgecrash.drop, 0)} drop over ${bridgecrash.years} yr at age ${bridgecrash.retirement_age}`} />
                <Stat label="Bridge Breaks: Baseline → Crash"
                  value={`${fmtPct(bridgecrash.base_bridge_break_rate, 0)} → ${fmtPct(bridgecrash.stressed_bridge_break_rate, 0)}`}
                  sub="penalty-free money runs out before 59½" />
                <Stat label="Early-Penalty Reliance: Baseline → Crash"
                  value={`${fmtPct(bridgecrash.base_early_penalty_rate, 0)} → ${fmtPct(bridgecrash.stressed_early_penalty_rate, 0)}`}
                  sub="paths forced to raid traditional early" />
              </div>
            )}
          </Section>
        </>
      )}

      {/* ───────────── OVERSAVING ───────────── */}
      <Head id="freedom-over">Oversaving — Could You Stop Sooner?</Head>
      <div className="stat-grid">
        <Section title="Estate Above Your Legacy" info={A.estateAboveLegacy}>
          {result ? (
            <Stat label="Beyond Both Spending & Bequest"
              value={fmtMoney(Math.max(0, lastReal - s.sim.legacy_target))}
              sub={s.sim.legacy_target > 0
                ? `median estate − ${fmtMoney(s.sim.legacy_target)} legacy`
                : "set a Legacy target on Assumptions"} />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>
        <Section title="Years Of Spending Unspent" info={A.estateYears}>
          {result && freedom && freedom.annual_retirement_expenses > 0 ? (
            <Stat label="Median Estate ÷ Annual Spending"
              value={`${Math.round(lastReal / freedom.annual_retirement_expenses)} yr`}
              sub="years of life converted to an estate" />
          ) : <p className="hint">{result ? "—" : "Simulation pending…"}</p>}
        </Section>
        <Section title="Portfolio Growth In Retirement" info={A.growthMultiple}>
          {result && growthMultiple > 0 ? (
            <Stat label="Median Ending ÷ Median At Retirement"
              value={`${growthMultiple.toFixed(1)}×`}
              sub="you lived on less than it earned" />
          ) : <p className="hint">{result ? "—" : "Simulation pending…"}</p>}
        </Section>
      </div>

      <Section title="Over-Saving Frontier" info={A.frontier}
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

      <Section title="Spending and Satisfaction" info={A.fulfillment}>
        {result ? (() => {
          const ages = result.ages;
          const spend = result.expenses_median_real;
          const total = spend.reduce((a, b) => a + b, 0);
          const shareWhere = (pred: (age: number) => boolean) =>
            total > 0 ? spend.reduce((acc, v, i) => acc + (pred(ages[i]) ? v : 0), 0) / total : 0;
          const active = shareWhere((a) => a <= goGoEnd);
          const inactive = shareWhere((a) => a > goGoEnd);
          return (
            <>
              <div className="fields">
                <Field label="Active Years End At Age"
                  info="Through this age a dollar buys full enjoyment; after it, enjoyment tapers as health and energy fade.">
                  <NumberInput value={goGoEnd} step={1} min={s.retirement_age} max={90} onChange={setGoGoEnd} />
                </Field>
                <Field label="Late-Life Enjoyment Floor"
                  info="How much a dollar is still worth from age 90 on, relative to the active years. Perkins' rough default is 30%.">
                  <PercentInput value={enjoyFloor} step={5} onChange={setEnjoyFloor} />
                </Field>
              </div>
              <div className="stat-grid" style={{ marginTop: 12 }}>
                <Stat label="Spent While Active" value={fmtPct(active, 0)} sub={`through age ${goGoEnd}`} />
                <Stat label="Spent While Inactive" value={fmtPct(inactive, 0)} sub={`age ${goGoEnd + 1}+`} />
              </div>
              <FulfillmentChart result={result} axisMode={axisMode}
                retirementAge={s.retirement_age} birthYear={s.profile.birth_year}
                goGoEnd={goGoEnd} floor={enjoyFloor} />
            </>
          );
        })() : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Ending Net Worth Distribution" info={A.endingBalance}>
        {result ? (() => {
          const vals = result.ending_balance.real;
          const p99 = Math.max(percentile(vals, 99), 1);
          const size = niceStep(p99 / 35);
          const start = Math.min(0, Math.floor(percentile(vals, 1) / size) * size);
          const end = Math.ceil(p99 / size) * size;
          const med = percentile(vals, 50);
          return (
            <HistogramChart values={vals} unit="money" uirevision="ending-real"
              bins={{ start, size, end }}
              markers={[{ value: med, label: `Median ${fmtMoney(med)}` }]}
              clampOverflow title=""
              xTitle={`Net Worth At Age ${s.profile.horizon_age}`} />
          );
        })() : <p className="hint">Simulation pending…</p>}
      </Section>
    </div>
  );
}
