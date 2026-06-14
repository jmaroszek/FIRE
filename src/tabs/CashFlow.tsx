import React, { useState } from "react";
import { A } from "../assumptions";
import {
  HealthcareTrajectoryChart, SpendingActualsChart, SpendingTrajectoryChart,
} from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import {
  Field, Group, InfoTip, NumberInput, PercentInput, Section, fmtMoney,
} from "../components/ui";
import { KIND_META, KIND_ORDER, displayKindOf, newEventOf, type DisplayKind } from "../events";
import { useStore } from "../store";
import type {
  AccountType, ExpenseStream, FireEvent, Liability, Scenario,
} from "../types";

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
      <Field label="Type">
        <span className="event-chip" style={{ background: meta.color + "22", color: meta.color }}>
          {meta.label}
        </span>
      </Field>
      <Field label="Name">
        <input className="event-name" value={ev.name} placeholder="Name"
          onChange={(e) => up({ name: e.target.value })} />
      </Field>
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
      <button className="ghost event-remove" onClick={remove}>✕</button>
    </div>
  );
}

export default function CashFlow() {
  const { scenario, result, axisMode, snapshots, categories } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [addKind, setAddKind] = useState<DisplayKind>("expense");
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const startAge = s.sim.start_year - s.profile.birth_year;

  // median healthcare cost/subsidy averaged over the pre-65 retired bridge years
  const hc = result?.healthcare;
  let hcWindow: { net: number; subsidy: number } | null = null;
  if (result && hc?.net_cost_real) {
    const idx = result.ages
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a >= s.retirement_age && a < s.aca.coverage_end_age)
      .map(({ i }) => i);
    if (idx.length) {
      const mean = (arr?: number[]) =>
        arr ? idx.reduce((sum, i) => sum + (arr[i] ?? 0), 0) / idx.length : 0;
      hcWindow = { net: mean(hc.net_cost_real), subsidy: mean(hc.subsidy_real) };
    }
  }

  const upStream = (i: number, patch: Partial<ExpenseStream>) => {
    const expense_streams = s.expense_streams.map((e, j) => (j === i ? { ...e, ...patch } : e));
    up({ expense_streams });
  };
  const moveStream = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.expense_streams.length) return;
    const expense_streams = [...s.expense_streams];
    [expense_streams[i], expense_streams[j]] = [expense_streams[j], expense_streams[i]];
    up({ expense_streams });
  };
  const upLiability = (i: number, patch: Partial<Liability>) => {
    const liabilities = (s.liabilities ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l));
    up({ liabilities });
  };
  // mirror of the engine's amortization, for the payoff-age hint
  const payoffAge = (l: Liability): number | null => {
    let bal = l.balance;
    for (let t = 0; t < 80; t++) {
      if (bal <= 1e-9) return startAge + t;
      bal *= 1 + l.interest_rate;
      bal -= Math.min(l.annual_payment, bal);
    }
    return null;
  };

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
              up({
                events: [...s.events,
                  newEventOf(addKind, Math.min(startAge + 5, s.profile.horizon_age), s)],
              })}>+ Add Event</button>
          </span>
        }>
        <TimelineEditor
          axisMode={axisMode}
          birthYear={s.profile.birth_year}
          startYear={s.sim.start_year}
          horizonAge={s.profile.horizon_age}
          retirementAge={s.retirement_age}
          events={s.events}
          onRetirementAge={(age) => up({ retirement_age: age })}
          onEventAge={(index, age) => {
            const events = s.events.map((e, j) =>
              j === index ? { ...e, age, year: null } : e);
            up({ events });
          }}
        />
        {s.events.length > 0 ? (
          <div className="event-details">
            <div className="event-details-head">Event Details</div>
            <div className="event-list">
              {s.events.map((ev, i) => <EventRow key={i} ev={ev} index={i} />)}
            </div>
          </div>
        ) : (
          <p className="hint">
            No events yet. Add a house down payment, an inheritance, a raise,
            an allocation shift, or a crash stress test — then drag it along the timeline.
          </p>
        )}
      </Section>

      <Section title="Income" info="Salary in today's dollars. It stops at retirement unless a later New Salary event sets another one.">
          <div className="fields">
            <Field label="Gross Salary">
              <NumberInput value={s.income.gross_salary} step={1000}
                onChange={(v) => up({ income: { ...s.income, gross_salary: v } })} />
            </Field>
            <Field label="Annual Raise (Nominal)"
              info="The raise number on your review letter (e.g. 3%). The engine subtracts expected inflation internally to get real growth.">
              <PercentInput value={s.income.real_growth} step={0.25}
                onChange={(v) => up({ income: { ...s.income, real_growth: v, growth_mode: "nominal" } })} />
            </Field>
            <Field label="Employer Match (% Of Salary)">
              <PercentInput value={s.income.employer_match_pct} step={0.5}
                onChange={(v) => up({ income: { ...s.income, employer_match_pct: v } })} />
            </Field>
          </div>
      </Section>

      <Group title="Spending">
        <Section
          wide
          title="Expenses"
          info="Baseline living costs in today's dollars. Loan payments belong under Debt & Liabilities instead."
          actions={
            <button className="ghost" onClick={() =>
              up({ expense_streams: [...s.expense_streams, {
                name: "New Stream", annual: 0, inflates: true, extra_inflation: 0,
                is_medical: false, essential: false,
              }] })}>+ Add Stream</button>
          }>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>$ / Yr</th>
                <th>Ages</th>
                <th>CPI +<InfoTip text={A.cpiPlus} /></th>
                <th>Inflates<InfoTip text={A.inflatesFlag} /></th>
                <th>HSA-Eligible<InfoTip text={A.hsaEligible} /></th>
                <th>Essential<InfoTip text="Essential streams are exempt from guardrail spending cuts." /></th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {s.expense_streams.map((e, i) => (
                <tr key={i}>
                  <td className="namecell"><input value={e.name} onChange={(ev) => upStream(i, { name: ev.target.value })} /></td>
                  <td><NumberInput value={e.annual} step={500} onChange={(v) => upStream(i, { annual: v })} /></td>
                  <td className="agecell">
                    <NumberInput value={e.start_age ?? startAge} step={1}
                      onChange={(v) => upStream(i, { start_age: v })} />
                    –
                    <NumberInput value={e.end_age ?? s.profile.horizon_age} step={1}
                      onChange={(v) => upStream(i, { end_age: v })} />
                  </td>
                  <td className="cpicell"><PercentInput value={e.extra_inflation} step={0.25}
                    onChange={(v) => upStream(i, { extra_inflation: v })} /></td>
                  <td><input type="checkbox" checked={e.inflates}
                    onChange={(ev) => upStream(i, { inflates: ev.target.checked })} /></td>
                  <td><input type="checkbox" checked={e.is_medical}
                    onChange={(ev) => upStream(i, { is_medical: ev.target.checked })} /></td>
                  <td><input type="checkbox" checked={e.essential}
                    onChange={(ev) => upStream(i, { essential: ev.target.checked })} /></td>
                  <td>
                    <span className="pair">
                      <button className="ghost" disabled={i === 0}
                        onClick={() => moveStream(i, -1)}>↑</button>
                      <button className="ghost" disabled={i === s.expense_streams.length - 1}
                        onClick={() => moveStream(i, 1)}>↓</button>
                    </span>
                  </td>
                  <td><button className="ghost" onClick={() =>
                    up({ expense_streams: s.expense_streams.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section wide title="Planned Spending Over Time" info={A.spendingTrajectory}>
          {result ? (
            <SpendingTrajectoryChart result={result} axisMode={axisMode}
              retirementAge={s.retirement_age} birthYear={s.profile.birth_year} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>

        <Section
          title="Debt & Liabilities"
          info={A.liabilities}
          actions={
            <button className="ghost" onClick={() =>
              up({ liabilities: [...(s.liabilities ?? []), {
                name: "New Loan", balance: 0, interest_rate: 0.05, annual_payment: 0,
              }] })}>+ Add Loan</button>
          }>
          {(s.liabilities ?? []).length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Balance</th>
                  <th>Rate</th>
                  <th>Payment / Yr</th>
                  <th>Paid Off<InfoTip text="Estimated age the amortization reaches zero, at the entered rate and payment. — means the payment doesn't cover interest." /></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(s.liabilities ?? []).map((l, i) => (
                  <tr key={i}>
                    <td className="namecell"><input value={l.name}
                      onChange={(ev) => upLiability(i, { name: ev.target.value })} /></td>
                    <td><NumberInput value={l.balance} step={5000}
                      onChange={(v) => upLiability(i, { balance: v })} /></td>
                    <td className="cpicell"><PercentInput value={l.interest_rate} step={0.25}
                      onChange={(v) => upLiability(i, { interest_rate: v })} /></td>
                    <td><NumberInput value={l.annual_payment} step={1000}
                      onChange={(v) => upLiability(i, { annual_payment: v })} /></td>
                    <td>{payoffAge(l) != null ? `Age ${payoffAge(l)}` : "—"}</td>
                    <td><button className="ghost" onClick={() =>
                      up({ liabilities: (s.liabilities ?? []).filter((_, j) => j !== i) })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">
              Mortgage, car loan, business loans. Payments count as essential
              non-inflating expenses; the outstanding balance reduces net worth.
            </p>
          )}
        </Section>

      </Group>

      <Group title="Healthcare">
        <Section title="ACA Premium Subsidy (Pre-65)" info={A.aca}>
          <div className="fields">
            <Field label="Enabled">
              <input type="checkbox" checked={s.aca.enabled}
                onChange={(e) => up({ aca: { ...s.aca, enabled: e.target.checked } })} />
            </Field>
            <Field label="Benchmark Premium (Today's $/yr)"
              info="The second-lowest-cost Silver plan in your area — the plan the subsidy is computed against. Look it up on healthcare.gov or your state exchange at your expected retirement income.">
              <NumberInput value={s.aca.benchmark_annual} step={500}
                onChange={(v) => up({ aca: { ...s.aca, benchmark_annual: v } })} />
            </Field>
            <Field label="Your Plan's Premium (Today's $/yr)"
              info="The full annual premium of the plan you'd actually buy, before subsidy. The subsidy can't exceed this.">
              <NumberInput value={s.aca.actual_annual} step={500}
                onChange={(v) => up({ aca: { ...s.aca, actual_annual: v } })} />
            </Field>
            <Field label="Coverage Ends At Age"
              info="Medicare eligibility — marketplace coverage (and this subsidy) stops here.">
              <NumberInput value={s.aca.coverage_end_age} step={1}
                onChange={(v) => up({ aca: { ...s.aca, coverage_end_age: v } })} />
            </Field>
          </div>
          {s.aca.enabled && hcWindow ? (
            <p className="hint">
              Median across the pre-65 bridge: subsidy {fmtMoney(hcWindow.subsidy)}/yr,
              net premium {fmtMoney(hcWindow.net)}/yr (today's $). Don't also list this
              premium as an expense stream, or you'll double-count it.
            </p>
          ) : (
            <p className="hint">
              Models the post-2021 subsidy (caps at 8.5% of MAGI, no income cliff) against
              the benchmark you enter. Roth conversions raise MAGI and shrink the subsidy —
              this is where the ladder and your healthcare cost collide.
            </p>
          )}
        </Section>

        <Section title="IRMAA Medicare Surcharge (65+)" info={A.irmaa}>
          <div className="fields">
            <Field label="Enabled">
              <input type="checkbox" checked={s.irmaa.enabled}
                onChange={(e) => up({ irmaa: { ...s.irmaa, enabled: e.target.checked } })} />
            </Field>
          </div>
          <p className="hint">
            Uses the 2025 single-filer Part B + D tiers (the surcharge starts above ~$106k
            MAGI). A high Roth-conversion or RMD year can trip a tier — cross-check the
            Projected RMDs and ladder tables on the Taxes tab.
          </p>
        </Section>

        <Section wide title="Healthcare Cost Over Time" info={A.healthcareTrajectory}>
          {result ? (
            <HealthcareTrajectoryChart result={result} axisMode={axisMode}
              retirementAge={s.retirement_age} coverageEndAge={s.aca.coverage_end_age}
              birthYear={s.profile.birth_year} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>
      </Group>

      <Group title="Spending Actuals">
        <Section wide title="Lifestyle Creep"
          info="Your recorded annual spending by category, converted to today's dollars using the assumed mean inflation, against the dashed line of what your plan budgets (active expense streams). Creep is the bars climbing past the line in real terms.">
          {snapshots.some((sn) => sn.spending && Object.values(sn.spending).some((v) => v > 0)) ? (
            <SpendingActualsChart
              snapshots={snapshots}
              categories={categories}
              inflationMean={s.inflation.mean}
              planTotal={s.expense_streams
                .filter((e) => (e.start_age ?? 0) <= startAge && startAge <= (e.end_age ?? 999))
                .reduce((a, e) => a + e.annual, 0)}
            />
          ) : (
            <p className="hint">
              No spending recorded yet. Use Dashboard → Record A Snapshot and fill the
              Annual Spending section with the category totals from your budget sheet —
              once a year is enough to see the trend.
            </p>
          )}
        </Section>
      </Group>
    </div>
  );
}
