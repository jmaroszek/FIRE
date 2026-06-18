import React, { useEffect } from "react";
import { A } from "../assumptions";
import {
  FrontierChart, HistogramChart, RuinAgeChart, SurfaceHeatmap, SurvivalChart,
  SweepGainChart, TornadoChart,
} from "../components/charts";
import { Field, ProgressBar, Section, SectionNav, Stat, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";
import type { Scenario } from "../types";

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

export default function Freedom() {
  const { scenario, result, display, axisMode,
          freedom, freedomLoading, runFreedom,
          sweep, sweeping, runSweep,
          surface, surfaceLoading, runSurface,
          sensitivity, sensitivityLoading, runSensitivity,
          bridgecrash } = useStore();
  const setScenario = useStore((s) => s.setScenario);

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
  const dollars = display === "real" ? "Today's" : "Nominal";

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "freedom-success", label: "Overall Success" },
        { id: "freedom-under", label: "Undersaving" },
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
                value={fmtMoney(freedom.fire_number_mc)} info={A.fireMc} />
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
                  value={`${result.failure_magnitude.failing_paths} of ${result.failure_magnitude.total_paths}`}
                  sub={`${fmtPct(result.failure_magnitude.failing_paths / result.failure_magnitude.total_paths, 0)} of scenarios`} />
              </Section>
              <Section title="Median Shortfall" info={A.failureSeverity}>
                <Stat label="Among Failing Paths (Today's $)"
                  value={fmtMoney(result.failure_magnitude.median_total_shortfall_real)}
                  sub={`worst 10%: ${fmtMoney(result.failure_magnitude.p90_total_shortfall_real)}`} />
              </Section>
              <Section title="Median Years Short" info={A.failureSeverity}>
                <Stat label="Years Spending Goes Unfunded"
                  value={String(result.failure_magnitude.median_years_short)}
                  sub="how long the shortfall lasts" />
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

          {bridgecrash && bridgecrash.has_bridge && (
            <Section title="Retire Into A Crash — Overall Success" info={A.bridgeCrash}>
              <Stat label="Success: Baseline → Crash"
                value={`${fmtPct(bridgecrash.base_success, 0)} → ${fmtPct(bridgecrash.stressed_success, 0)}`}
                sub={`${bridgecrash.success_delta >= 0 ? "+" : ""}${fmtPct(bridgecrash.success_delta)} vs baseline · a ${fmtPct(bridgecrash.drop, 0)} drop over ${bridgecrash.years} yr at age ${bridgecrash.retirement_age}`} />
              <p className="hint">Run or tune this crash test on the Accounts tab (Bridge section) — its bridge-specific break and early-penalty rates live there.</p>
            </Section>
          )}

          <p className="hint" style={{ maxWidth: "none" }}>
            <strong>Why the years just after retirement are the riskiest:</strong> a market drop right
            when you stop earning forces selling depressed assets you can't rebuy (sequence-of-returns
            risk); the penalty-free bridge is longest and most strained; there's no wage income to
            cushion it; and Social Security hasn't started. Clear that first decade with assets intact
            and the hazard falls fast — which is exactly why the survival curve drops, then levels off.
            The levers that help most: a cash-bucket or rising-equity glidepath (Accounts), flexible
            spending (guardrails / VPW, Cash Flow), a bigger liquid bridge, retiring a year or two
            later, or part-time income early.
          </p>
        </>
      )}

      {/* ───────────── OVERSAVING ───────────── */}
      <Head id="freedom-over">Oversaving — Could You Stop Sooner?</Head>
      <div className="stat-grid">
        <Section title="Median Ending Net Worth" info={A.headroom}>
          {result ? (
            <Stat label="At The Horizon (Today's $)" value={fmtMoney(lastReal)}
              sub="unconsumed margin, not a goal" info={A.headroom} />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>
        <Section title="Years Of Spending Unspent" info={A.estateYears}>
          {result && freedom && freedom.annual_retirement_expenses > 0 ? (
            <Stat label="Median Estate ÷ Annual Spending"
              value={`${Math.round(lastReal / freedom.annual_retirement_expenses)} yr`}
              sub="years of life converted to an estate" info={A.estateYears} />
          ) : <p className="hint">{result ? "—" : "Simulation pending…"}</p>}
        </Section>
        <Section title="Estate Above Your Legacy" info={A.estateAboveLegacy}>
          {result ? (
            <Stat label="Beyond Both Spending & Bequest"
              value={fmtMoney(Math.max(0, lastReal - s.sim.legacy_target))}
              sub={s.sim.legacy_target > 0
                ? `median estate − ${fmtMoney(s.sim.legacy_target)} legacy`
                : "set a Legacy target on Assumptions"}
              info={A.estateAboveLegacy} />
          ) : <p className="hint">Simulation pending…</p>}
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

      <Section title="Ending Net Worth Distribution" info={A.endingBalance}>
        {result ? (() => {
          const vals = result.ending_balance[display];
          const end = Math.max(percentile(vals, 99), 1);
          const size = Math.max(1000, Math.ceil(end / 40 / 1000) * 1000);
          return (
            <HistogramChart values={vals} unit="money" uirevision={display}
              bins={{ start: Math.min(0, percentile(vals, 1)), size, end: Math.ceil(end / size) * size }}
              clampOverflow title=""
              xTitle={`Net Worth At Age ${s.profile.horizon_age} (${dollars} $, p99+ grouped)`} />
          );
        })() : <p className="hint">Simulation pending…</p>}
      </Section>
    </div>
  );
}
