import React from "react";
import { CompareChart, CompareSweepChart } from "../components/charts";
import { Section, fmtMoney, fmtPct } from "../components/ui";
import { useStore, type CompareSlot } from "../store";

function yearsToFi(slot: CompareSlot): string {
  if (slot.sweepPending) return "…";
  if (!slot.sweep) return "—";
  const startAge = slot.scenario.sim.start_year - slot.scenario.profile.birth_year;
  const ages = Object.keys(slot.sweep.sweep).map(Number).sort((a, b) => a - b);
  for (const a of ages) {
    if (slot.sweep.sweep[String(a)] >= slot.sweep.threshold) {
      return `${a - startAge} yr (age ${a})`;
    }
  }
  return "> 70";
}

export default function Compare() {
  const { compare, addToCompare, removeFromCompare, result, axisMode, display } = useStore();
  const anySweep = compare.some((c) => c.sweep);

  return (
    <div className="stack">
      <Section
        title="Scenario comparison"
        info="Pin the current scenario's results, tweak inputs, pin again — overlay as many as you like. Success curves compute in the background for each pin."
        actions={
          <button onClick={addToCompare} disabled={!result}>
            + pin current scenario
          </button>
        }>
        {compare.length === 0 ? (
          <p className="hint">
            Nothing pinned yet. Run a simulation, pin it, change something (allocation,
            retirement age, an event, guardrails), and pin again to compare futures side by side.
          </p>
        ) : (
          <>
            <CompareChart slots={compare} axisMode={axisMode} display={display} />
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th><th>Success</th><th>Retire @</th><th>Years to FI</th>
                  <th>Median end (real)</th><th>5th pctile end (real)</th><th />
                </tr>
              </thead>
              <tbody>
                {compare.map((slot) => {
                  const fan = slot.result.fan.real;
                  const last = fan.p50.length - 1;
                  return (
                    <tr key={slot.name}>
                      <td>{slot.name}</td>
                      <td>{fmtPct(slot.result.success_rate)}</td>
                      <td>{slot.scenario.retirement_age}</td>
                      <td>{yearsToFi(slot)}</td>
                      <td>{fmtMoney(fan.p50[last])}</td>
                      <td>{fmtMoney(fan.p5[last])}</td>
                      <td>
                        <button className="ghost" onClick={() => removeFromCompare(slot.name)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {anySweep && (
        <Section
          title="When can each scenario retire?"
          info="The success-probability curves of every pinned scenario, overlaid. Where a curve crosses your threshold is that scenario's earliest safe retirement age.">
          <CompareSweepChart slots={compare} axisMode={axisMode} />
        </Section>
      )}
    </div>
  );
}
