import React from "react";
import { A } from "../assumptions";
import { HealthcareCostChart } from "../components/charts";
import {
  Field, HeroRow, HeroStat, InfoTip, NumberInput, PercentInput,
  Section, fmtMoney,
} from "../components/ui";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import type { ExpenseStream, Scenario } from "../types";

function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

const ageRangeTip =
  "Both ends inclusive - 30-40 runs from the year you turn 30 through the year you turn 40 (11 years).";

export default function Healthcare() {
  const { scenario, result, axisMode } = useStore(useShallow((s) => ({
    scenario: s.scenario, result: s.result, axisMode: s.axisMode,
  })));
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;

  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;
  const upMedical = (i: number, patch: Partial<ExpenseStream>) =>
    up({ medical_streams: (s.medical_streams ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const ltc = s.ltc ?? { enabled: false, onset_age: 84, annual_cost: 0, duration_years: 3, extra_inflation: 0.015 };

  const netHc = result?.healthcare?.net_cost_real ?? [];
  const subHc = result?.healthcare?.subsidy_real ?? [];
  const lifetimeHc = netHc.reduce((a, b) => a + b, 0);
  const peakHc = netHc.length ? Math.max(...netHc) : 0;
  const peakHcAge = peakHc > 1 && result ? result.ages[netHc.indexOf(peakHc)] : null;
  const subCaptured = subHc.reduce((a, b) => a + b, 0);
  const acaCoverageStartAge = s.aca.coverage_start_age > 0
    ? s.aca.coverage_start_age
    : s.retirement_age;

  return (
    <div className="stack">
      <Head id="healthcare">Healthcare</Head>
      <HeroRow>
        <HeroStat tone="purple" label="Lifetime Net Healthcare" value={fmtMoney(lifetimeHc)}
          sub="premiums - subsidy + IRMAA, today's $"
          info="Sum of modeled net healthcare cost over the plan (median path). Zero until you enable ACA or IRMAA below." />
        <HeroStat tone="purple" label="Peak Annual Net Cost" value={fmtMoney(peakHc)}
          sub={peakHcAge ? `at age ${peakHcAge}` : "enable ACA / IRMAA to model"} />
        <HeroStat tone="green" label="ACA Subsidy Captured" value={fmtMoney(subCaptured)}
          sub="lifetime, today's $" />
      </HeroRow>

      <div className="group-grid stretch healthcare-grid">
        <div className="healthcare-left-stack">
          <Section
            title="Medical Spending (HSA-Eligible)"
            className="healthcare-medical"
            info="Out-of-pocket medical spending, kept separate from general expenses. Always essential; the HSA pays its share (set utilization under HSA on the Accounts tab). Don't list insurance premiums here - those are modeled under ACA / IRMAA, which add on top."
            actions={
              <button className="ghost" onClick={() =>
                up({ medical_streams: [...(s.medical_streams ?? []), {
                  name: "Out-Of-Pocket Medical", annual: 0, inflates: true, extra_inflation: 0,
                  is_medical: false, essential: true,
                }] })}>+ Add Medical</button>
            }>
            {(s.medical_streams ?? []).length > 0 ? (
              <div className="medical-table-scroll">
                <table className="table fit">
              <thead>
                <tr><th>Name</th><th>$ / Yr</th><th>Ages<InfoTip text={ageRangeTip} /></th>
                  <th>CPI +<InfoTip text={A.cpiPlus} /></th><th /></tr>
              </thead>
              <tbody>
                {(s.medical_streams ?? []).map((e, i) => (
                  <tr key={i}>
                    <td className="namecell"><input value={e.name} onChange={(ev) => upMedical(i, { name: ev.target.value })} /></td>
                    <td><NumberInput value={e.annual} step={250} onChange={(v) => upMedical(i, { annual: v })} /></td>
                    <td className="agecell">
                      <NumberInput value={e.start_age ?? startAge} step={1}
                        onChange={(v) => upMedical(i, { start_age: v })} />
                      -
                      <NumberInput value={e.end_age ?? s.profile.horizon_age} step={1}
                        onChange={(v) => upMedical(i, { end_age: v })} />
                    </td>
                    <td className="cpicell"><PercentInput value={e.extra_inflation} step={0.25}
                      onChange={(v) => upMedical(i, { extra_inflation: v })} /></td>
                    <td><button className="ghost" onClick={() =>
                      up({ medical_streams: (s.medical_streams ?? []).filter((_, j) => j !== i) })}>x</button></td>
                  </tr>
                ))}
              </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">No medical streams yet. Add prescriptions, dental, copays - the spending your HSA is meant to cover.</p>
            )}
          </Section>

          <Section title="Long-Term Care" info={A.ltc} className="healthcare-ltc">
            <div className="fields">
              <Field label="Enabled">
                <input type="checkbox" checked={ltc.enabled}
                  onChange={(e) => up({ ltc: { ...ltc, enabled: e.target.checked,
                    annual_cost: e.target.checked && ltc.annual_cost <= 0 ? 75000 : ltc.annual_cost } })} />
              </Field>
              <Field label="Quick-Fill Cost"
                info="Typical US median costs (2024). Sets the annual cost; edit it after if your area differs.">
                <select value="" onChange={(e) => {
                  if (e.target.value) up({ ltc: { ...ltc, annual_cost: parseFloat(e.target.value) } }); }}>
                  <option value="">Choose...</option>
                  <option value="75000">In-Home Aide (~$75k/yr)</option>
                  <option value="70000">Assisted Living (~$70k/yr)</option>
                  <option value="95000">Nursing Home, Semi-Private (~$95k/yr)</option>
                  <option value="120000">Nursing Home, Private (~$120k/yr)</option>
                </select>
              </Field>
              <Field label="Annual Cost (Today's $)">
                <NumberInput value={ltc.annual_cost} step={5000} min={0}
                  onChange={(v) => up({ ltc: { ...ltc, annual_cost: v } })} />
              </Field>
              <Field label="Starts At Age"
                info="When care begins. Most long-term-care need lands in the mid-80s.">
                <NumberInput value={ltc.onset_age} step={1} min={s.retirement_age} max={s.profile.horizon_age}
                  onChange={(v) => up({ ltc: { ...ltc, onset_age: v } })} />
              </Field>
              <Field label="For How Long (Years)">
                <NumberInput value={ltc.duration_years} step={1} min={1}
                  onChange={(v) => up({ ltc: { ...ltc, duration_years: Math.max(1, Math.round(v)) } })} />
              </Field>
            </div>
            <p className="hint">
              Adds late-life care as an essential, HSA-eligible expense over the window you set.
              Off by default; turn it on to stress-test one of the plan's largest tail costs.
            </p>
          </Section>
        </div>

        <Section title="Premium & MAGI Modeling" info={A.healthcareTrajectory} className="span1 healthcare-premiums">
          <div className="premium-modeling-block">
            <h4>ACA Premium Subsidy (Pre-65)<InfoTip text={A.aca} /></h4>
            <div className="premium-fields">
              <Field label="Enabled">
                <input type="checkbox" checked={s.aca.enabled}
                  onChange={(e) => up({ aca: { ...s.aca, enabled: e.target.checked } })} />
              </Field>
              <div className="premium-row premium-row-paired">
                <Field label="Benchmark Premium"
                  info="The second-lowest-cost Silver plan in your area - the plan the subsidy is computed against. Today's $/yr.">
                  <NumberInput value={s.aca.benchmark_annual} step={500}
                    onChange={(v) => up({ aca: { ...s.aca, benchmark_annual: v } })} />
                </Field>
                <Field label="Your Plan's Premium"
                  info="The premium for the plan you actually expect to buy. Today's $/yr.">
                  <NumberInput value={s.aca.actual_annual} step={500}
                    onChange={(v) => up({ aca: { ...s.aca, actual_annual: v } })} />
                </Field>
              </div>
              <div className="premium-row premium-row-paired">
                <Field label="Coverage Starts At Age"
                  info="Defaults to your retirement age. Set a later age to model going uninsured, using COBRA elsewhere, employer coverage from part-time work, or another bridge before marketplace coverage begins.">
                  <NumberInput value={acaCoverageStartAge} step={1} min={s.retirement_age}
                    onChange={(v) => up({ aca: { ...s.aca, coverage_start_age: v } })} />
                </Field>
                <Field label="Coverage Ends At Age"
                  info="Medicare eligibility - marketplace coverage (and this subsidy) stops here.">
                  <NumberInput value={s.aca.coverage_end_age} step={1}
                    onChange={(v) => up({ aca: { ...s.aca, coverage_end_age: v } })} />
                </Field>
              </div>
            </div>
            <p className="hint">Models the MAGI-linked pre-65 subsidy. Do not also list this premium as an expense stream.</p>
          </div>

          <div className="premium-modeling-block">
            <h4>IRMAA Medicare Surcharge (65+)<InfoTip text={A.irmaa} /></h4>
            <div className="fields">
              <Field label="Enabled">
                <input type="checkbox" checked={s.irmaa.enabled}
                  onChange={(e) => up({ irmaa: { ...s.irmaa, enabled: e.target.checked } })} />
              </Field>
            </div>
            <p className="hint">
              A high Roth-conversion or RMD year can trip a tier; tune the conversion ladder on
              Accounts and check RMD pressure on Taxes.
            </p>
          </div>
        </Section>
      </div>

      <Section title="Net Healthcare Cost" info={A.healthcareTrajectory}>
        {result ? (
          result.healthcare?.net_cost_real?.some((v) => v > 1)
            || result.healthcare?.subsidy_real?.some((v) => v > 1) ? (
            <HealthcareCostChart result={result} axisMode={axisMode}
              retirementAge={s.retirement_age} coverageStartAge={acaCoverageStartAge}
              coverageEndAge={s.aca.coverage_end_age}
              birthYear={s.profile.birth_year} />
          ) : (
            <p className="hint">
              No modeled healthcare cost yet. Turn on ACA Premium Subsidy or IRMAA above
              to see net premium, subsidy, and surcharge over life.
            </p>
          )
        ) : <p className="hint">Simulation pending...</p>}
      </Section>
    </div>
  );
}
