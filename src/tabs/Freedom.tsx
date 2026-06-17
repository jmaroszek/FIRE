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

export default function Freedom() {
  const { scenario, result, display, axisMode,
          freedom, freedomLoading, runFreedom,
          sweep, sweeping, runSweep,
          surface, surfaceLoading, runSurface,
          sensitivity, sensitivityLoading, runSensitivity } = useStore();
  const setScenario = useStore((s) => s.setScenario);

  // This tab owns the freedom bundle and the sweep; populate both on a cold visit.
  useEffect(() => { if (scenario && !freedom && !freedomLoading) void runFreedom(); }, [scenario, freedom]);
  useEffect(() => { if (scenario && !sweep && !sweeping) void runSweep(); }, [scenario, sweep]);

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
          ) : <p className="hint">{freedomLoading ? "Computing…" : "—"}</p>}
        </Section>

        <Section title="Coast FIRE" info={A.coast}>
          {freedom ? (
            <>
              <Stat label="Current Invested Total" value={fmtMoney(freedom.current_total)} />
              <Stat label={`Needed Today To Coast To ${s.sim.coast_target_age}`}
                value={fmtMoney(freedom.coast.coast_number)}
                sub={`assumes ${fmtPct(freedom.coast.assumed_real_return)} real return for ${freedom.coast.years_to_target} years`} />
              <ProgressBar fraction={freedom.coast.progress} />
            </>
          ) : <p className="hint">{freedomLoading ? "Computing…" : "—"}</p>}
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
        ) : (
          <button onClick={runSweep} disabled={sweeping}>
            {sweeping ? "Computing…" : "Compute"}
          </button>
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
        {sensitivity ? <TornadoChart data={sensitivity} />
          : <button onClick={runSensitivity} disabled={sensitivityLoading}>
              {sensitivityLoading ? "Computing…" : "Compute Sensitivity"}
            </button>}
      </Section>

      {/* ───────────── UNDERSAVING ───────────── */}
      <Head id="freedom-under">Undersaving — Could It Fall Short?</Head>
      {result && (
        <>
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
        </>
      )}

      {/* ───────────── OVERSAVING ───────────── */}
      <Head id="freedom-over">Oversaving — Could You Stop Sooner?</Head>
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

      <Section title="Headroom" info={A.headroom}>
        {result ? (
          <>
            <Stat label="Median Ending Net Worth" value={fmtMoney(lastReal)}
              sub="today's $ — unconsumed margin, not a goal" info={A.headroom} />
            {freedom && freedom.annual_retirement_expenses > 0 && (
              <Stat label="≈ Years Of Spending Unspent"
                value={`${Math.round(lastReal / freedom.annual_retirement_expenses)} yr`}
                sub="median estate ÷ annual retirement spending" info={A.estateYears} />
            )}
          </>
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Ending Net Worth Distribution" info={A.endingBalance}>
        {result ? (
          <HistogramChart values={result.ending_balance[display]} unit="money" uirevision={display}
            title="" xTitle={`Net Worth At Age ${s.profile.horizon_age} (${dollars} $)`} />
        ) : <p className="hint">Simulation pending…</p>}
      </Section>
    </div>
  );
}
