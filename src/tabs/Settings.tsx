import React from "react";
import { Field, InfoTip, NumberInput, PercentInput, Section } from "../components/ui";
import { useStore } from "../store";

export default function Settings() {
  const { scenario, categories, setCategories } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;
  const s = scenario;

  return (
    <div className="grid2">
      <Section title="Profile">
        <div className="fields">
          <Field label="Birth Year">
            <NumberInput value={s.profile.birth_year} step={1}
              onChange={(v) => setScenario({ ...s, profile: { ...s.profile, birth_year: v } })} />
          </Field>
          <Field label="Plan To Age" info="Fixed planning horizon — no mortality table.">
            <NumberInput value={s.profile.horizon_age} step={1} min={50} max={105}
              onChange={(v) => setScenario({ ...s, profile: { ...s.profile, horizon_age: v } })} />
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

      <Section
        title="Spending Categories"
        info="Categories for recorded spending snapshots (Dashboard → Record A Snapshot) and the Cash Flow → Lifestyle Creep chart. Add-only by design: names and order are freely editable, but each category keeps a permanent internal id so renames never break your history. Order is purely organizational."
        actions={
          <button className="ghost" onClick={() => {
            const name = "New Category";
            let slug = "new-category";
            let n = 2;
            while (categories.some((c) => c.slug === slug)) slug = `new-category-${n++}`;
            setCategories([...categories, { slug, name, essential: false }]);
          }}>+ Add Category</button>
        }>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Essential<InfoTip text="Counts toward the essential (non-discretionary) share of spending, matching the Essential flag on expense streams." /></th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={c.slug}>
                <td className="namecell">
                  <input value={c.name} onChange={(ev) =>
                    setCategories(categories.map((x, j) =>
                      j === i ? { ...x, name: ev.target.value } : x))} />
                </td>
                <td>
                  <input type="checkbox" checked={c.essential} onChange={(ev) =>
                    setCategories(categories.map((x, j) =>
                      j === i ? { ...x, essential: ev.target.checked } : x))} />
                </td>
                <td>
                  <span className="pair">
                    <button className="ghost" disabled={i === 0} onClick={() => {
                      const next = [...categories];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setCategories(next);
                    }}>↑</button>
                    <button className="ghost" disabled={i === categories.length - 1} onClick={() => {
                      const next = [...categories];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      setCategories(next);
                    }}>↓</button>
                  </span>
                </td>
                <td>
                  <button className="ghost" title="Remove (existing snapshot data is kept)"
                    onClick={() => setCategories(categories.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="About The Model">
        <p className="hint">
          Every simplifying assumption is documented in <code>docs/ASSUMPTIONS.md</code> —
          annual timestep, five tax pools, federal brackets + flat state rate, Shiller
          1871–2022 bootstrap, AR(1) inflation, single filer, fixed horizon. Tax modeling
          includes the Social Security provisional-income torpedo, a lifetime Roth-conversion
          ladder, RMDs, and pre-65 ACA premium subsidies + 65+ IRMAA surcharges. The ⓘ markers
          throughout the app carry the short versions. Refresh the IRS data tables in
          <code>engine/fire_engine/data/</code> each November.
        </p>
      </Section>
    </div>
  );
}
