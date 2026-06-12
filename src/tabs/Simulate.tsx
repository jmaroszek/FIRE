import React, { useState } from "react";
import { A } from "../assumptions";
import { FanChart, SweepChart } from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import { Field, NumberInput, PercentInput, Section, fmtPct } from "../components/ui";
import { KIND_META, KIND_ORDER, displayKindOf, newEventOf, type DisplayKind } from "../events";
import { useStore } from "../store";
import type { AccountType, FireEvent } from "../types";

function EventRow({ ev, index }: { ev: FireEvent; index: number }) {
  const scenario = useStore((s) => s.scenario)!;
  const setScenario = useStore((s) => s.setScenario);
  const kind = displayKindOf(ev);
  const meta = KIND_META[kind];

  const up = (patch: Partial<FireEvent>) => {
    const events = scenario.events.map((e, j) => (j === index ? { ...e, ...patch } : e));
    setScenario({ ...scenario, events });
  };
  const remove = () =>
    setScenario({ ...scenario, events: scenario.events.filter((_, j) => j !== index) });

  return (
    <div className="event-row">
      <span className="event-chip" style={{ background: meta.color + "22", color: meta.color }}>
        {meta.label}
      </span>
      <input className="event-name" value={ev.name} placeholder="Name"
        onChange={(e) => up({ name: e.target.value })} />
      <Field label="Age">
        <NumberInput value={ev.age ?? (ev.year ?? scenario.sim.start_year) - scenario.profile.birth_year}
          step={1} onChange={(v) => up({ age: v, year: null })} />
      </Field>
      {(kind === "expense" || kind === "income") && (
        <>
          <Field label="Amount">
            <NumberInput value={Math.abs(ev.amount)} step={5000} min={0}
              onChange={(v) => up({ amount: kind === "income" ? -Math.abs(v) : Math.abs(v) })} />
          </Field>
          <Field label={kind === "income" ? "Deposit Into" : "Pay From"}>
            <select value={ev.account ?? ""} onChange={(e) =>
              up({ account: (e.target.value || null) as AccountType | null })}>
              <option value="">{kind === "income" ? "Brokerage (Default)" : "Withdrawal Policy"}</option>
              <option value="cash">Cash</option>
              <option value="taxable">Brokerage</option>
              {kind === "expense" && <option value="trad_401k">Traditional</option>}
              {kind === "expense" && <option value="roth_ira">Roth</option>}
              {kind === "expense" && <option value="hsa">HSA</option>}
            </select>
          </Field>
        </>
      )}
      {kind === "crash" && (
        <>
          <Field label="Stock Return">
            <PercentInput value={ev.stock_return ?? -0.35} step={5}
              onChange={(v) => up({ stock_return: v })} />
          </Field>
          <Field label="Bond Return">
            <PercentInput value={ev.bond_return ?? 0} step={1}
              onChange={(v) => up({ bond_return: v })} />
          </Field>
        </>
      )}
      {kind === "salary" && (
        <>
          <Field label="New Gross Salary (Today's $)">
            <NumberInput value={ev.overrides?.gross_salary ?? 0} step={5000}
              onChange={(v) => up({ overrides: { ...ev.overrides, gross_salary: v } })} />
          </Field>
          <Field label="Raise / Yr">
            <PercentInput value={ev.overrides?.salary_real_growth ?? scenario.income.real_growth}
              step={0.25}
              onChange={(v) => up({ overrides: { ...ev.overrides, salary_real_growth: v } })} />
          </Field>
        </>
      )}
      {kind === "allocation" && (
        <Field label="Stocks % (Rest To Bonds)">
          <PercentInput
            value={ev.overrides?.allocation?.stocks ?? scenario.allocation.stocks}
            step={5}
            onChange={(v) =>
              up({ overrides: { allocation: { stocks: v, bonds: Math.max(0, 1 - v), cash: 0 } } })} />
        </Field>
      )}
      <button className="ghost" onClick={remove}>✕</button>
    </div>
  );
}

export default function Simulate() {
  const { scenario, result, simulating, simError, sweep, sweeping, runSweep,
          axisMode, display, setDisplay, snapshots } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [addKind, setAddKind] = useState<DisplayKind>("expense");
  const [showTails, setShowTails] = useState(false);
  if (!scenario) return null;

  const startAge = scenario.sim.start_year - scenario.profile.birth_year;
  const retMarker = axisMode === "age"
    ? scenario.retirement_age
    : scenario.profile.birth_year + scenario.retirement_age;

  return (
    <div className="stack">
      <Section
        title="Life Events"
        info={A.events}
        actions={
          <span className="pair">
            <select value={addKind} onChange={(e) => setAddKind(e.target.value as DisplayKind)}>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
            <button onClick={() =>
              setScenario({
                ...scenario,
                events: [...scenario.events,
                  newEventOf(addKind, Math.min(startAge + 5, scenario.profile.horizon_age), scenario)],
              })}>+ Add Event</button>
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
        {scenario.events.length > 0 ? (
          <div className="event-details">
            <div className="event-details-head">Event Details</div>
            <div className="event-list">
              {scenario.events.map((ev, i) => <EventRow key={i} ev={ev} index={i} />)}
            </div>
          </div>
        ) : (
          <p className="hint">
            No events yet. Add a house down payment, an inheritance, a raise,
            an allocation shift, or a crash stress test — then drag it along the timeline.
          </p>
        )}
      </Section>

      <Section
        title="Projection"
        info={A.successRate}
        actions={
          <span className="pair">
            {simulating && <span className="badge">Simulating…</span>}
            {scenario.guardrails.enabled && (
              <span className="badge" title="Spending guardrails active — discretionary spending flexes with market performance">
                Guardrails On
              </span>
            )}
            {result && (
              <span className="badge success">
                Success {fmtPct(result.success_rate)}
              </span>
            )}
            <label className="pair hint" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={showTails}
                onChange={(e) => setShowTails(e.target.checked)} />
              5–95% Band
            </label>
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
            showTails={showTails}
          />
        ) : (
          <p className="hint">Running first simulation…</p>
        )}
        <div className="fields slider-row">
          <Field label={`Retirement Age: ${scenario.retirement_age}`}>
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
        title="When Can I Retire?"
        info="Success probability if you retire at each age, holding everything else constant. Uses one shared set of market paths so the curve is noise-free across ages."
        actions={
          <button onClick={runSweep} disabled={sweeping}>
            {sweeping ? "Computing…" : sweep ? "Recompute" : "Compute"}
          </button>
        }>
        {sweep ? (
          <>
            <SweepChart sweep={sweep} axisMode={axisMode} birthYear={scenario.profile.birth_year} />
            <p className="hint">
              {sweep.years_to_fi != null
                ? `Earliest retirement age meeting your ${fmtPct(sweep.threshold, 0)} threshold: ${startAge + sweep.years_to_fi} (${sweep.years_to_fi} years away).`
                : `No retirement age up to 70 meets your ${fmtPct(sweep.threshold, 0)} threshold yet.`}
            </p>
          </>
        ) : (
          <p className="hint">Click Compute — sweeps every retirement age through 70 (~a few seconds).</p>
        )}
      </Section>
    </div>
  );
}
