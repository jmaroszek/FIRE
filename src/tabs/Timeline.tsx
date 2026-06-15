import React, { useEffect } from "react";
import { A } from "../assumptions";
import { RetirementSpendingChart, SurfaceHeatmap, SweepGainChart } from "../components/charts";
import { Field, ProgressBar, Section, Stat, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";
import type { Scenario } from "../types";

export default function Timeline() {
  const { scenario, result, freedom, freedomLoading, runFreedom, sweep, runSweep, sweeping,
          maxspend, runMaxSpend, maxspendLoading, surface, runSurface, surfaceLoading,
          axisMode } = useStore();
  const setScenario = useStore((s) => s.setScenario);

  // This tab owns both the freedom bundle and the sweep, so populate them on a
  // cold visit (idempotent — the store guards against duplicate in-flight runs).
  useEffect(() => { if (scenario && !freedom && !freedomLoading) void runFreedom(); }, [scenario, freedom]);
  useEffect(() => { if (scenario && !sweep && !sweeping) void runSweep(); }, [scenario, sweep]);

  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;
  const suggestedAge = sweep && sweep.years_to_fi != null ? startAge + sweep.years_to_fi : null;
  const lastReal = result?.fan.real.p50[result.fan.real.p50.length - 1] ?? 0;

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

      <Section title="Retirement Spending"
        info="What a year in retirement costs on the median path: living expenses plus net healthcare (ACA premium after subsidy, then IRMAA at 65+).">
        {result ? (
          <RetirementSpendingChart result={result} axisMode={axisMode}
            retirementAge={s.retirement_age} coverageEndAge={s.aca.coverage_end_age}
            birthYear={s.profile.birth_year} />
        ) : <p className="hint">Simulation pending…</p>}
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
    </div>
  );
}
