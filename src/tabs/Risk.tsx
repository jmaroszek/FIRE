import React, { useState } from "react";
import { A } from "../assumptions";
import {
  HistogramChart, RealizedReturnFan, RuinAgeChart, SequenceScatter,
  SpendingDepthChart, SurvivalChart,
} from "../components/charts";
import { Field, NumberInput, Section, Stat, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function Risk() {
  const { scenario, result, display, axisMode, stress, runStress, stressLoading } = useStore();
  const startAge = scenario ? scenario.sim.start_year - scenario.profile.birth_year : 40;
  // default to a mid-career shock: a shock at the current (lowest-savings) age
  // trivially fails on every path, which is true but uninformative as a default.
  const midCareer = scenario
    ? Math.round((startAge + scenario.retirement_age) / 2) : startAge;
  const [shockAge, setShockAge] = useState(midCareer);
  const [shockDur, setShockDur] = useState(3);
  if (!scenario) return null;
  if (!result) {
    return (
      <div className="stack">
        <Section title="Risk & Robustness">
          <p className="hint">Simulation pending…</p>
        </Section>
      </div>
    );
  }

  const ci = result.success_ci;
  const endingVals = result.ending_balance[display];
  const medEnding = median(endingVals);
  const medDrawdown = median(result.max_drawdown);
  const medYearsCut = median(result.spending_distribution.years_in_cut);
  const dollars = display === "real" ? "Today's" : "Nominal";

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Plan Success" info={A.successRate}>
          <Stat label="Success Probability" value={fmtPct(ci.rate)}
            sub={`Retire at ${scenario.retirement_age}, horizon ${scenario.profile.horizon_age}`} />
          <Stat label="Monte Carlo 95% Interval"
            value={`${fmtPct(ci.lo)} – ${fmtPct(ci.hi)}`}
            sub={`Sampling error across ${ci.n_paths.toLocaleString()} paths`}
            info={A.successCi} />
        </Section>

        <Section title="Outcome Snapshot">
          <Stat label="Median Ending Net Worth" value={fmtMoney(medEnding)}
            sub={`${dollars} $`} info={A.endingBalance} />
          <Stat label="Median Maximum Drawdown" value={fmtPct(medDrawdown)} info={A.drawdown} />
          <Stat label="Median Years In A Guardrail Cut"
            value={scenario.guardrails.enabled ? String(medYearsCut) : "—"}
            sub={scenario.guardrails.enabled ? undefined : "guardrails off"}
            info={A.spendingDelivered} />
        </Section>
      </div>

      <Section title="Ending Net Worth Distribution" info={A.endingBalance}>
        <HistogramChart values={endingVals} unit="money" uirevision={display}
          title="" xTitle={`Net Worth At Age ${scenario.profile.horizon_age} (${dollars} $)`} />
      </Section>

      <Section title="Survival Curve" info={A.survival}>
        <SurvivalChart result={result} axisMode={axisMode}
          retirementAge={scenario.retirement_age}
          threshold={scenario.sim.success_threshold}
          birthYear={scenario.profile.birth_year} />
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
            <Stat label="Median Years Short"
              value={String(result.failure_magnitude.median_years_short)}
              sub={`worst 10%: ${fmtMoney(result.failure_magnitude.p90_total_shortfall_real)}`} />
          </div>
        ) : (
          <p className="hint">No path ran short — there is no shortfall to size.</p>
        )}
      </Section>

      <Section title="Sequence-Of-Returns Risk" info={A.sequenceRisk}>
        <SequenceScatter data={result.sequence_scatter} />
      </Section>

      <Section title="Realized Real Return" info={A.realizedReturn}>
        <RealizedReturnFan result={result} axisMode={axisMode}
          retirementAge={scenario.retirement_age} birthYear={scenario.profile.birth_year} />
      </Section>

      <Section title="Maximum Drawdown (Real)" info={A.drawdown}>
        <HistogramChart values={result.max_drawdown} unit="percent" color="rgba(210,153,34,0.55)"
          title="" xTitle="Deepest Peak-To-Trough Fall In Real Net Worth" />
      </Section>

      <Section title="Lifetime Spending Delivered" info={A.spendingDelivered}>
        <HistogramChart values={result.spending_distribution.total_real} unit="money"
          color="rgba(63,185,80,0.5)" title=""
          xTitle="Total Real Spending Funded Over The Plan (Today's $)" />
      </Section>

      <Section title="Realized Spending Level" info={A.spendingDepth}>
        <SpendingDepthChart result={result} axisMode={axisMode}
          retirementAge={scenario.retirement_age}
          enabled={scenario.spending_strategy.kind !== "constant_dollar" || scenario.guardrails.enabled}
          floor={scenario.spending_strategy.kind === "floor_ceiling" ? scenario.spending_strategy.floor_mult
            : scenario.spending_strategy.kind === "constant_dollar" ? scenario.guardrails.floor_mult : 0}
          cap={scenario.spending_strategy.kind === "floor_ceiling" ? scenario.spending_strategy.ceiling_mult
            : scenario.spending_strategy.kind === "constant_dollar" ? scenario.guardrails.cap_mult : 0}
          birthYear={scenario.profile.birth_year} />
      </Section>

      <Section title="Income Shock Stress Test" info={A.stressTest}>
        <div className="fields">
          <Field label="Shock Starts At Age"
            info="The age your wages drop to zero. Most meaningful before your retirement age, while you're still relying on income.">
            <NumberInput value={shockAge} step={1} min={startAge} max={scenario.retirement_age}
              onChange={setShockAge} />
          </Field>
          <Field label="Duration (Years)">
            <NumberInput value={shockDur} step={1} min={1} max={20} onChange={setShockDur} />
          </Field>
          <button onClick={() => runStress(shockAge, shockDur)} disabled={stressLoading}>
            {stressLoading ? "Computing…" : "Run Stress Test"}
          </button>
        </div>
        {stress && (
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <Stat label="Baseline Success" value={fmtPct(stress.base_success)} />
            <Stat label={`After A ${stress.duration}-Year Shock At Age ${stress.shock_age}`}
              value={fmtPct(stress.stressed_success)}
              sub={`${stress.delta >= 0 ? "+" : ""}${fmtPct(stress.delta)} vs baseline`} />
          </div>
        )}
      </Section>
    </div>
  );
}
