import React from "react";
import { Field, NumberInput, PercentInput, Section } from "../components/ui";
import { useStore } from "../store";

export default function Settings() {
  const { scenario, axisMode, setAxisMode, display, setDisplay } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;
  const s = scenario;

  return (
    <div className="grid2">
      <Section title="Display">
        <div className="fields">
          <Field label="Timeline Axis">
            <select value={axisMode} onChange={(e) => setAxisMode(e.target.value as any)}>
              <option value="age">My Age</option>
              <option value="year">Calendar Year</option>
            </select>
          </Field>
          <Field label="Dollars">
            <select value={display} onChange={(e) => setDisplay(e.target.value as any)}>
              <option value="real">Today's (Real)</option>
              <option value="nominal">Nominal</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Simulation">
        <div className="fields">
          <Field label="Monte Carlo Paths"
            info="More paths = smoother percentiles, slower recompute. 2,000 runs in ~200 ms.">
            <NumberInput value={s.sim.n_paths} step={500} min={100} max={20000}
              onChange={(v) => setScenario({ ...s, sim: { ...s.sim, n_paths: v } })} />
          </Field>
          <Field label="Random Seed">
            <NumberInput value={s.sim.seed} step={1}
              onChange={(v) => setScenario({ ...s, sim: { ...s.sim, seed: v } })} />
          </Field>
          <Field label="Success Threshold"
            info="A retirement age 'works' when at least this share of paths never run out of money.">
            <PercentInput value={s.sim.success_threshold} step={1}
              onChange={(v) => setScenario({ ...s, sim: { ...s.sim, success_threshold: v } })} />
          </Field>
          <Field label="Coast Target Age">
            <NumberInput value={s.sim.coast_target_age} step={1}
              onChange={(v) => setScenario({ ...s, sim: { ...s.sim, coast_target_age: v } })} />
          </Field>
        </div>
      </Section>

      <Section title="About The Model">
        <p className="hint">
          Every simplifying assumption is documented in <code>docs/ASSUMPTIONS.md</code> —
          annual timestep, five tax pools, federal brackets + flat state rate, Shiller
          1871–2022 bootstrap, AR(1) inflation, no ACA subsidy modeling, single filer,
          fixed horizon. The ⓘ markers throughout the app carry the short versions.
          Refresh the IRS data tables in <code>engine/fire_engine/data/</code> each November.
        </p>
      </Section>
    </div>
  );
}
