import React from "react";
import { CompareChart } from "../components/charts";
import { Section, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";

export default function Compare() {
  const { compare, addToCompare, removeFromCompare, result, axisMode, display } = useStore();

  return (
    <div className="stack">
      <Section
        title="Scenario comparison"
        info="Pin the current scenario's results, tweak inputs, pin again — overlay as many as you like."
        actions={
          <button onClick={addToCompare} disabled={!result}>
            + pin current scenario
          </button>
        }>
        {compare.length === 0 ? (
          <p className="hint">
            Nothing pinned yet. Run a simulation, pin it, change something (allocation,
            retirement age, an event), and pin again to compare futures side by side.
          </p>
        ) : (
          <>
            <CompareChart slots={compare} axisMode={axisMode} display={display} />
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th><th>Success</th><th>Retire @</th>
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
    </div>
  );
}
