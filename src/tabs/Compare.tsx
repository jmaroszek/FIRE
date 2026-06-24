import React from "react";
import { A } from "../assumptions";
import { CompareBridgeChart, CompareChart, CompareSweepChart } from "../components/charts";
import { useShallow } from "zustand/react/shallow";
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
  const { compare, addToCompare, removeFromCompare, result, axisMode } = useStore(useShallow((s) => ({
    compare: s.compare, addToCompare: s.addToCompare, removeFromCompare: s.removeFromCompare,
    result: s.result, axisMode: s.axisMode,
  })));
  const anySweep = compare.some((c) => c.sweep);
  const anyBridge = compare.some((c) => c.result.bridge?.has_bridge);

  return (
    <div className="stack">
      <Section
        title="Scenario Comparison"
        info="Pin the current scenario's results, tweak inputs, pin again — overlay as many as you like. Success curves compute in the background for each pin."
        actions={
          <button onClick={addToCompare} disabled={!result}>
            + Pin Current Scenario
          </button>
        }>
        {compare.length === 0 ? (
          <p className="hint">
            Nothing pinned yet. Run a simulation, pin it, change something (allocation,
            retirement age, an event, guardrails), and pin again to compare futures side by side.
          </p>
        ) : (
          <>
            <CompareChart slots={compare} axisMode={axisMode} />
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th><th>Success</th><th>Retire @</th><th>Years To FI</th>
                  <th>Median End (Real)</th><th>5th Pctile End (Real)</th><th />
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

      {anyBridge && (
        <Section title="Bridge Confidence Side By Side" info={A.bridgeConfidence}>
          <table className="table">
            <thead>
              <tr>
                <th>Scenario</th><th>Bridge Holds</th><th>Coverage (Median)</th>
                <th>Runway vs Gap</th><th>Accessible @ Retire</th><th>Early Penalty</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((slot) => {
                const b = slot.result.bridge;
                if (!b) return (
                  <tr key={slot.name}>
                    <td>{slot.name}</td>
                    <td colSpan={5} className="hint">Re-pin to compute bridge metrics</td>
                  </tr>
                );
                if (!b.has_bridge) return (
                  <tr key={slot.name}>
                    <td>{slot.name}</td>
                    <td colSpan={5} className="hint">No bridge — retires at/after 59½</td>
                  </tr>
                );
                return (
                  <tr key={slot.name}>
                    <td>{slot.name}</td>
                    <td>{fmtPct(1 - (b.bridge_break_rate ?? 0), 0)}</td>
                    <td>
                      {(b.coverage_p50 ?? 0).toFixed(2)}×{" "}
                      <span className="hint">(p5 {(b.coverage_p5 ?? 0).toFixed(2)}×)</span>
                    </td>
                    <td>{Math.round(b.runway_p50 ?? 0)} / {b.bridge_years} yr</td>
                    <td>{fmtPct(b.at_retirement?.pct_accessible ?? 0, 0)}</td>
                    <td>{fmtPct(b.early_penalty_rate ?? 0, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <CompareBridgeChart slots={compare} axisMode={axisMode} />
        </Section>
      )}

      {anySweep && (
        <Section
          title="When Can Each Scenario Retire?"
          info="The success-probability curves of every pinned scenario, overlaid. Where a curve crosses your threshold is that scenario's earliest safe retirement age.">
          <CompareSweepChart slots={compare} axisMode={axisMode} />
        </Section>
      )}
    </div>
  );
}
