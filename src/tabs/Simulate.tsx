import React, { useState } from "react";
import { A } from "../assumptions";
import { FanChart, SweepChart } from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import { Field, NumberInput, PercentInput, Section, fmtPct } from "../components/ui";
import { useStore } from "../store";
import type { AccountType, EventKind, FireEvent } from "../types";

const EVENT_KIND_LABELS: Record<EventKind, string> = {
  one_time_flow: "One-time flow",
  regime_change: "Regime change",
  crash: "Market crash",
};

function newEvent(kind: EventKind, age: number): FireEvent {
  if (kind === "one_time_flow")
    return { kind, name: "Expense", age, amount: 20000 };
  if (kind === "crash")
    return { kind, name: "Crash", age, amount: 0, stock_return: -0.35 };
  return { kind, name: "New salary", age, amount: 0, overrides: { gross_salary: 120000 } };
}

function EventRow({ ev, index }: { ev: FireEvent; index: number }) {
  const scenario = useStore((s) => s.scenario)!;
  const setScenario = useStore((s) => s.setScenario);
  const up = (patch: Partial<FireEvent>) => {
    const events = scenario.events.map((e, j) => (j === index ? { ...e, ...patch } : e));
    setScenario({ ...scenario, events });
  };
  const remove = () =>
    setScenario({ ...scenario, events: scenario.events.filter((_, j) => j !== index) });

  return (
    <div className="event-row">
      <span className={`event-chip ${ev.kind}`}>{EVENT_KIND_LABELS[ev.kind]}</span>
      <input className="event-name" value={ev.name} placeholder="name"
        onChange={(e) => up({ name: e.target.value })} />
      <Field label="Age">
        <NumberInput value={ev.age ?? (ev.year ?? scenario.sim.start_year) - scenario.profile.birth_year}
          step={1} onChange={(v) => up({ age: v, year: null })} />
      </Field>
      {ev.kind === "one_time_flow" && (
        <>
          <Field label="Amount (+expense / −windfall)">
            <NumberInput value={ev.amount} step={5000} onChange={(v) => up({ amount: v })} />
          </Field>
          <Field label="From/to account">
            <select value={ev.account ?? ""} onChange={(e) =>
              up({ account: (e.target.value || null) as AccountType | null })}>
              <option value="">withdrawal policy</option>
              <option value="cash">cash</option>
              <option value="taxable">taxable</option>
              <option value="trad_401k">traditional</option>
              <option value="roth_ira">Roth</option>
              <option value="hsa">HSA</option>
            </select>
          </Field>
        </>
      )}
      {ev.kind === "crash" && (
        <>
          <Field label="Stock return">
            <PercentInput value={ev.stock_return ?? -0.35} step={5}
              onChange={(v) => up({ stock_return: v })} />
          </Field>
          <Field label="Bond return (blank = sampled)">
            <PercentInput value={ev.bond_return ?? 0} step={1}
              onChange={(v) => up({ bond_return: v })} />
          </Field>
        </>
      )}
      {ev.kind === "regime_change" && (
        <>
          <Field label="New salary (blank = keep)">
            <NumberInput value={ev.overrides?.gross_salary ?? 0} step={5000}
              onChange={(v) => up({ overrides: { ...ev.overrides, gross_salary: v } })} />
          </Field>
          <Field label="Salary growth">
            <PercentInput value={ev.overrides?.salary_real_growth ?? scenario.income.real_growth}
              step={0.25}
              onChange={(v) => up({ overrides: { ...ev.overrides, salary_real_growth: v } })} />
          </Field>
          <Field label="Stocks alloc (sets stocks/bonds)">
            <PercentInput
              value={ev.overrides?.allocation?.stocks ?? scenario.allocation.stocks}
              step={5}
              onChange={(v) =>
                up({ overrides: { ...ev.overrides, allocation: { stocks: v, bonds: Math.max(0, 1 - v), cash: 0 } } })} />
          </Field>
        </>
      )}
      <button className="ghost" onClick={remove}>✕</button>
    </div>
  );
}

export default function Simulate() {
  const { scenario, result, simulating, simError, sweep, sweeping, runSweep,
          axisMode, display, setDisplay, snapshots } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [addKind, setAddKind] = useState<EventKind>("one_time_flow");
  if (!scenario) return null;

  const startAge = scenario.sim.start_year - scenario.profile.birth_year;
  const retMarker = axisMode === "age"
    ? scenario.retirement_age
    : scenario.profile.birth_year + scenario.retirement_age;

  return (
    <div className="stack">
      <Section
        title="Life events"
        info={A.events}
        actions={
          <span className="pair">
            <select value={addKind} onChange={(e) => setAddKind(e.target.value as EventKind)}>
              {Object.entries(EVENT_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button onClick={() =>
              setScenario({
                ...scenario,
                events: [...scenario.events, newEvent(addKind, Math.min(startAge + 5, scenario.profile.horizon_age))],
              })}>+ add event</button>
          </span>
        }>
        <TimelineEditor
          axisMode={axisMode}
          birthYear={scenario.profile.birth_year}
          startYear={scenario.sim.start_year}
          horizonAge={scenario.profile.horizon_age}
          retirementAge={scenario.retirement_age}
          events={scenario.events}
          onRetirementAge={(age) => setScenario({ ...scenario, retirement_age: age })}
          onEventAge={(index, age) => {
            const events = scenario.events.map((e, j) =>
              j === index ? { ...e, age, year: null } : e);
            setScenario({ ...scenario, events });
          }}
        />
        <div className="event-list">
          {scenario.events.map((ev, i) => <EventRow key={i} ev={ev} index={i} />)}
          {scenario.events.length === 0 && (
            <p className="hint">No events yet. Add a house down payment, a raise, a career change, or a crash stress test.</p>
          )}
        </div>
      </Section>

      <Section
        title="Projection"
        info={A.successRate}
        actions={
          <span className="pair">
            {simulating && <span className="badge">simulating…</span>}
            {scenario.guardrails.enabled && (
              <span className="badge" title="Spending guardrails active — discretionary spending flexes with market performance">
                guardrails on
              </span>
            )}
            {result && (
              <span className="badge success">
                success {fmtPct(result.success_rate)}
              </span>
            )}
            <select value={display} onChange={(e) => setDisplay(e.target.value as any)}>
              <option value="real">Today's $</option>
              <option value="nominal">Nominal $</option>
            </select>
          </span>
        }>
        {simError && <p className="error">{simError}</p>}
        {result ? (
          <FanChart
            result={result}
            axisMode={axisMode}
            display={display}
            retirementMarker={retMarker}
            snapshots={snapshots}
            startYear={scenario.sim.start_year}
            birthYear={scenario.profile.birth_year}
          />
        ) : (
          <p className="hint">Running first simulation…</p>
        )}
        <div className="fields slider-row">
          <Field label={`Retirement age: ${scenario.retirement_age}`}>
            <input type="range" min={startAge + 1} max={70} value={scenario.retirement_age}
              onChange={(e) => setScenario({ ...scenario, retirement_age: parseInt(e.target.value) })} />
          </Field>
          <Field label={`Stocks: ${Math.round(scenario.allocation.stocks * 100)}%`}>
            <input type="range" min={0} max={100} step={5}
              value={Math.round(scenario.allocation.stocks * 100)}
              onChange={(e) => {
                const stocks = parseInt(e.target.value) / 100;
                setScenario({
                  ...scenario,
                  allocation: { stocks, bonds: Math.max(0, 1 - stocks - scenario.allocation.cash), cash: scenario.allocation.cash },
                });
              }} />
          </Field>
        </div>
      </Section>

      <Section
        title="When can I retire?"
        info="Success probability if you retire at each age, holding everything else constant. Uses one shared set of market paths so the curve is noise-free across ages."
        actions={
          <button onClick={runSweep} disabled={sweeping}>
            {sweeping ? "computing…" : sweep ? "recompute" : "compute"}
          </button>
        }>
        {sweep ? (
          <>
            <SweepChart sweep={sweep} axisMode={axisMode} birthYear={scenario.profile.birth_year} />
            <p className="hint">
              {sweep.years_to_fi != null
                ? `Earliest retirement age meeting your ${fmtPct(sweep.threshold, 0)} threshold: ${scenario.sim.start_year - scenario.profile.birth_year + sweep.years_to_fi} (${sweep.years_to_fi} years away).`
                : `No retirement age up to 70 meets your ${fmtPct(sweep.threshold, 0)} threshold yet.`}
            </p>
          </>
        ) : (
          <p className="hint">Click compute — sweeps every retirement age through 70 (~a few seconds).</p>
        )}
      </Section>
    </div>
  );
}
