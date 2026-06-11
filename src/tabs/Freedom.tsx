import React, { useEffect } from "react";
import { A } from "../assumptions";
import { AccessibilityChart } from "../components/charts";
import { ProgressBar, Section, Stat, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";

export default function Freedom() {
  const { scenario, result, freedom, freedomLoading, runFreedom, sweep, runSweep,
          sweeping, axisMode } = useStore();

  useEffect(() => {
    if (scenario && !freedom && !freedomLoading) void runFreedom();
  }, [scenario, freedom]);

  if (!scenario) return null;
  const startAge = scenario.sim.start_year - scenario.profile.birth_year;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="FIRE number" info={A.fireMc}>
          {freedom ? (
            <>
              <Stat label={`MC-derived (≥${fmtPct(freedom.success_threshold, 0)} success, retire today)`}
                value={fmtMoney(freedom.fire_number_mc)} info={A.fireMc} />
              <ProgressBar fraction={freedom.fire_progress_mc ?? 0} />
              <Stat label="Classic 25× expenses" value={fmtMoney(freedom.fire_number_simple)}
                sub={`${fmtMoney(freedom.annual_retirement_expenses)}/yr at retirement age`}
                info={A.fireSimple} />
              <ProgressBar fraction={freedom.fire_progress_simple ?? 0} />
            </>
          ) : (
            <p className="hint">{freedomLoading ? "computing…" : "—"}</p>
          )}
        </Section>

        <Section title="Coast FIRE" info={A.coast}>
          {freedom ? (
            <>
              <Stat
                label={`Needed today to coast to ${scenario.sim.coast_target_age}`}
                value={fmtMoney(freedom.coast.coast_number)}
                sub={`assumes ${fmtPct(freedom.coast.assumed_real_return)} real return for ${freedom.coast.years_to_target} years`} />
              <ProgressBar fraction={freedom.coast.progress} />
              <Stat label="Current invested total" value={fmtMoney(freedom.current_total)} />
            </>
          ) : (
            <p className="hint">{freedomLoading ? "computing…" : "—"}</p>
          )}
        </Section>

        <Section title="Years to retirement"
          info="From the retirement-age sweep: the earliest age whose success probability meets your threshold.">
          {sweep ? (
            <Stat
              label={`At ≥${fmtPct(sweep.threshold, 0)} success`}
              value={sweep.years_to_fi != null ? `${sweep.years_to_fi} years` : "> age 70"}
              sub={sweep.years_to_fi != null ? `retire at ${startAge + sweep.years_to_fi}` : undefined} />
          ) : (
            <button onClick={runSweep} disabled={sweeping}>
              {sweeping ? "computing…" : "compute sweep"}
            </button>
          )}
        </Section>
      </div>

      <Section title="Liquidity: can you bridge to 59½?" info={A.accessibility}>
        {result ? (
          <AccessibilityChart result={result} axisMode={axisMode} />
        ) : (
          <p className="hint">Run a simulation first (Simulate tab).</p>
        )}
      </Section>

      <Section title="Roth conversion ladder schedule" info={A.ladder}>
        {result && result.ladder_schedule.length > 0 ? (
          <table className="table">
            <thead>
              <tr><th>Year</th><th>Age</th><th>Convert (today's $)</th><th>Penalty-free in</th></tr>
            </thead>
            <tbody>
              {result.ladder_schedule.map((r) => (
                <tr key={r.year}>
                  <td>{r.year}</td>
                  <td>{r.age}</td>
                  <td>{fmtMoney(r.amount_real)}</td>
                  <td>{r.matures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">
            No conversions in the median path. Enable a ladder under Inputs → Roth conversion ladder.
          </p>
        )}
      </Section>
    </div>
  );
}
