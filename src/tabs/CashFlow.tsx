import React, { useEffect, useState } from "react";
import { A } from "../assumptions";
import {
  AccountFlowsChart, HealthcareCostChart, SpendingActualsChart,
} from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import {
  Field, HeroRow, HeroStat, InfoTip, MixPanel, NumberInput, PercentInput,
  Section, SectionNav, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { KIND_META, KIND_ORDER, displayKindOf, newEventOf, type DisplayKind } from "../events";
import { useStore } from "../store";
import type {
  AccountType, ExpenseStream, FireEvent, IncomeStream, Scenario,
} from "../types";

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

/** Age ranges in the income/expense tables are inclusive on both endpoints. */
const ageRangeTip =
  "Both ends inclusive — 30–40 runs from the year you turn 30 through the year you turn 40 (11 years).";

/** PIA adjustment by claiming age, FRA=67 — mirrors SS_CLAIMING_FACTORS in the
 * engine (scenario.py). Only the three signpost ages are shown in the tile table. */
const SS_KEY_CLAIM_AGES: { age: number; factor: number; note?: string }[] = [
  { age: 62, factor: 0.70, note: "Earliest" },
  { age: 67, factor: 1.00, note: "FRA" },
  { age: 70, factor: 1.24, note: "Latest" },
];

/** One editable row in the Life Events list. The crash/allocation branches stay
 * editable for existing events, but both are dropped from the add menu (better
 * stress tools live on Freedom; allocation glides live on Accounts). */
function EventRow({ ev, index }: { ev: FireEvent; index: number }) {
  const scenario = useStore((s) => s.scenario)!;
  const setScenario = useStore((s) => s.setScenario);
  const kind = displayKindOf(ev);
  const meta = KIND_META[kind];
  const evAge = ev.age ?? ((ev.year ?? scenario.sim.start_year) - scenario.profile.birth_year);

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
      {(kind === "expense" || kind === "income" || kind === "recurring") && (
        <>
          <Field label="Amount">
            <NumberInput value={Math.abs(ev.amount)} step={kind === "recurring" ? 1000 : 5000} min={0}
              onChange={(v) => up({ amount: kind === "income" ? -Math.abs(v) : Math.abs(v) })} />
          </Field>
          {kind === "recurring" && (
            <>
              <Field label="Every (Years)">
                <NumberInput value={ev.interval_years ?? 3} step={1} min={1}
                  onChange={(v) => up({ interval_years: Math.max(1, Math.round(v)) })} />
              </Field>
              <Field label="Until Age">
                <NumberInput value={ev.end_age ?? scenario.profile.horizon_age} step={1}
                  onChange={(v) => up({ end_age: v })} />
              </Field>
            </>
          )}
          <Field label={kind === "income" ? "Deposit Into" : "Pay From"}>
            <select value={ev.account ?? ""} onChange={(e) =>
              up({ account: (e.target.value || null) as AccountType | null })}>
              <option value="">{kind === "income" ? "Brokerage (Default)" : "Withdrawal Policy"}</option>
              <option value="cash">Cash</option>
              <option value="taxable">Brokerage</option>
              {kind === "income" && <option value="roth_ira">Roth IRA</option>}
              {/* Traditional/HSA before their penalty-free ages cause a 10% penalty
                  (which the engine counts as a path failure), so they're only
                  offered once the event is old enough — but a value already set is
                  never hidden out from under the user. (Recurring keys off its
                  first occurrence age, the conservative gate.) */}
              {(kind === "expense" || kind === "recurring") && (evAge >= 60 || ev.account === "trad_401k") &&
                <option value="trad_401k">Traditional{evAge < 60 ? " (early — penalty)" : ""}</option>}
              {(kind === "expense" || kind === "recurring") && <option value="roth_ira">Roth</option>}
              {(kind === "expense" || kind === "recurring") && (evAge >= 65 || ev.account === "hsa") &&
                <option value="hsa">HSA{evAge < 65 ? " (pre-65 — penalty)" : ""}</option>}
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
  const { scenario, result, axisMode, categories, snapshots,
          maxspend, runMaxSpend, maxspendLoading,
          stress, stressLoading, runStress } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [addKind, setAddKind] = useState<DisplayKind>("expense");
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;
  const midCareer = Math.round((startAge + s.retirement_age) / 2);
  const [shockAge, setShockAge] = useState(midCareer);
  const [shockDur, setShockDur] = useState(1);

  // Headroom & Resilience tiles compute automatically (like the Freedom tab),
  // showing a spinner instead of waiting on a manual button. Both results are
  // nulled on every edit by the store, so this re-runs them stale-while-revalidate.
  useEffect(() => {
    if (scenario && !maxspend && !maxspendLoading) void runMaxSpend();
  }, [scenario, maxspend]);
  useEffect(() => {
    if (scenario && !stress && !stressLoading) void runStress(shockAge, shockDur);
  }, [scenario, stress]);

  const upStream = (i: number, patch: Partial<ExpenseStream>) =>
    up({ expense_streams: s.expense_streams.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const moveStream = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.expense_streams.length) return;
    const expense_streams = [...s.expense_streams];
    [expense_streams[i], expense_streams[j]] = [expense_streams[j], expense_streams[i]];
    up({ expense_streams });
  };
  const sortExpensesByAmount = () =>
    up({ expense_streams: [...s.expense_streams].sort((a, b) => b.annual - a.annual) });
  const upMedical = (i: number, patch: Partial<ExpenseStream>) =>
    up({ medical_streams: (s.medical_streams ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const upIncome = (i: number, patch: Partial<IncomeStream>) =>
    up({ income_streams: (s.income_streams ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const ss = s.spending_strategy;

  // ---- section hero metrics (always-on; from scenario + median result) -------
  const activeNow = (start?: number | null, end?: number | null) =>
    (start ?? startAge) <= startAge && startAge <= (end ?? 999);
  const grossIncomeNow = s.income.gross_salary
    + (s.income_streams ?? []).filter((i) => activeNow(i.start_age, i.end_age))
        .reduce((a, i) => a + i.annual, 0);
  const nStreams = (s.income_streams ?? []).length;
  const plannedSpendNow =
    s.expense_streams.filter((e) => activeNow(e.start_age, e.end_age)).reduce((a, e) => a + e.annual, 0)
    + (s.medical_streams ?? []).filter((e) => activeNow(e.start_age, e.end_age)).reduce((a, e) => a + e.annual, 0);
  const contribNow = result
    ? Object.values(result.investing_real ?? {}).reduce((sum, arr) => sum + (arr?.[0] ?? 0), 0) : 0;
  const savingsRate = grossIncomeNow > 0 ? contribNow / grossIncomeNow : 0;

  // ---- gutter "mix" breakdowns beside the Income / Expenses tables (today's $) ---
  const employerMatchNow = s.income.gross_salary * s.income.employer_match_pct;
  // The income mix is only worth showing once there's more than one source to
  // compare — salary alone (plus a sliver of match) is a pointless two-bar chart.
  const hasSideIncome = (s.income_streams ?? [])
    .some((i) => activeNow(i.start_age, i.end_age) && i.annual > 0);
  const incomeMix = [
    { label: "Primary Salary", value: s.income.gross_salary, color: "#58a6ff" },
    ...(s.income_streams ?? [])
      .filter((i) => activeNow(i.start_age, i.end_age))
      .map((i) => ({ label: i.name || "Side Income", value: i.annual, color: "#58a6ff" })),
    { label: "Employer Match", value: employerMatchNow, color: "#58a6ff" },
  ];
  // Spending-mix bars reflect spending ACTIVE AT THE CURRENT AGE, so a future-dated
  // stream (e.g. a mortgage that starts at 40) doesn't draw a bar that distorts today's
  // mix — it gets a "from age X" note instead. Sized/summed over the active subset.
  const activeExpenses = s.expense_streams.filter((e) => activeNow(e.start_age, e.end_age));
  const expMax = Math.max(0, ...activeExpenses.map((e) => e.annual));
  const expTotal = activeExpenses.reduce((a, e) => a + e.annual, 0);
  const expEssential = activeExpenses.filter((e) => e.essential).reduce((a, e) => a + e.annual, 0);
  const upcomingExpenses = s.expense_streams
    .filter((e) => e.annual > 0 && !activeNow(e.start_age, e.end_age)).length;

  const retIdx = result ? result.ages.findIndex((a) => a >= s.retirement_age) : -1;
  const netHc = result?.healthcare?.net_cost_real ?? [];
  const subHc = result?.healthcare?.subsidy_real ?? [];
  const annualRetSpend = result && retIdx >= 0
    ? (result.expenses_median_real[retIdx] ?? 0) + (netHc[retIdx] ?? 0) : 0;
  // What the chosen spending strategy actually funds in the first retirement year
  // (living + medical, median path) vs the plan's intended amount — the readout
  // that makes a portfolio-% strategy starving discretionary spending visible.
  const modeledRetSpend = result && retIdx >= 0 ? (result.expenses_median_real[retIdx] ?? 0) : 0;
  const activeAt = (age: number, start?: number | null, end?: number | null) =>
    (start ?? startAge) <= age && age <= (end ?? 999);
  const plannedAtRet =
    s.expense_streams.filter((e) => activeAt(s.retirement_age, e.start_age, e.end_age))
      .reduce((a, e) => a + e.annual, 0)
    + (s.medical_streams ?? []).filter((e) => activeAt(s.retirement_age, e.start_age, e.end_age))
      .reduce((a, e) => a + e.annual, 0);
  const lifetimeRetSpend = result && retIdx >= 0
    ? result.expenses_median_real.slice(retIdx).reduce((a, b) => a + b, 0) : 0;
  const goGoShare = (() => {
    if (!result) return 0;
    const sp = result.expenses_median_real;
    const tot = sp.reduce((a, b) => a + b, 0);
    return tot > 0 ? sp.reduce((acc, v, i) => acc + (result.ages[i] <= 75 ? v : 0), 0) / tot : 0;
  })();
  const lifetimeHc = netHc.reduce((a, b) => a + b, 0);
  const peakHc = netHc.length ? Math.max(...netHc) : 0;
  const peakHcAge = peakHc > 1 && result ? result.ages[netHc.indexOf(peakHc)] : null;
  const subCaptured = subHc.reduce((a, b) => a + b, 0);

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "cf-earn", label: "Earning & Saving" },
        { id: "cf-flow", label: "Cash Flow Over Time" },
        { id: "cf-headroom", label: "Headroom & Resilience" },
        { id: "cf-retire", label: "Spending In Retirement" },
        { id: "cf-health", label: "Healthcare" },
      ]} />

      {/* ───────────── EARNING & SAVING ───────────── */}
      <Head id="cf-earn">Earning &amp; Saving</Head>
      <HeroRow>
        <HeroStat label="Gross Income" value={`${fmtMoney(grossIncomeNow)}/yr`}
          sub={nStreams > 0 ? `salary + ${nStreams} other stream${nStreams > 1 ? "s" : ""}` : "primary salary"} />
        <HeroStat tone="amber" label="Planned Spending" value={`${fmtMoney(plannedSpendNow)}/yr`}
          sub="living + medical, today's $" />
        <HeroStat tone="green" label="Savings Rate" value={fmtPct(savingsRate, 0)}
          sub={`${fmtMoney(contribNow)}/yr invested`}
          info="This year's modeled contributions (all destinations) as a share of gross income." />
      </HeroRow>

      <Section title="Income"
        info="Salary in today's dollars; the primary salary stops at retirement unless a New Salary event sets another. Add other streams below for side income.">
        <div className="fields">
          <Field label="Primary Gross Salary">
            <NumberInput value={s.income.gross_salary} step={1000}
              onChange={(v) => up({ income: { ...s.income, gross_salary: v } })} />
          </Field>
          <Field label="Annual Raise"
            info="Nominal — the raise number on your review letter (e.g. 3%). The engine subtracts expected inflation internally to get real growth.">
            <PercentInput value={s.income.real_growth} step={0.25}
              onChange={(v) => up({ income: { ...s.income, real_growth: v, growth_mode: "nominal" } })} />
          </Field>
          <Field label="Employer Match"
            info="Percent of your salary your employer adds to your 401(k), on top of your own contributions.">
            <PercentInput value={s.income.employer_match_pct} step={0.5}
              onChange={(v) => up({ income: { ...s.income, employer_match_pct: v } })} />
          </Field>
        </div>
        <div className="card-split">
          <div className="card-split-main">
        <div className="card-head" style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>
            Other Income Streams
            <InfoTip text="Side income beyond the primary salary — consulting, rental, a spouse, or a barista-FI gig in early retirement. No employer match; active over its age range; Volatility adds year-to-year variability the steady primary salary doesn't have." />
          </h3>
          <button className="ghost" onClick={() => up({ income_streams: [...(s.income_streams ?? []),
            { name: "Side Income", annual: 0, real_growth: 0, growth_mode: "nominal", vol: 0 }] })}>
            + Add Stream
          </button>
        </div>
        {(s.income_streams ?? []).length > 0 && (
          <table className="table fit">
            <thead><tr><th>Name</th><th>$ / Yr</th><th>Ages<InfoTip text={ageRangeTip} /></th><th>Raise / Yr</th><th>Volatility</th><th>SS Wages<InfoTip text="Check if this is your own FICA/self-employment-taxed income (a bonus, consulting, a side business) — it then counts toward your Social Security earnings record. Leave off for rental, dividends, pensions, or a spouse's wages." /></th><th /></tr></thead>
            <tbody>
              {(s.income_streams ?? []).map((inc, i) => (
                <tr key={i}>
                  <td className="namecell"><input value={inc.name}
                    onChange={(e) => upIncome(i, { name: e.target.value })} /></td>
                  <td><NumberInput value={inc.annual} step={1000}
                    onChange={(v) => upIncome(i, { annual: v })} /></td>
                  <td className="agecell">
                    <NumberInput value={inc.start_age ?? startAge} step={1}
                      onChange={(v) => upIncome(i, { start_age: v })} />
                    –
                    <NumberInput value={inc.end_age ?? s.profile.horizon_age} step={1}
                      onChange={(v) => upIncome(i, { end_age: v })} />
                  </td>
                  <td className="cpicell"><PercentInput value={inc.real_growth} step={0.25}
                    onChange={(v) => upIncome(i, { real_growth: v, growth_mode: "nominal" })} /></td>
                  <td className="cpicell"><PercentInput value={inc.vol} step={1}
                    onChange={(v) => upIncome(i, { vol: v })} /></td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={inc.ss_covered ?? false}
                    onChange={(e) => upIncome(i, { ss_covered: e.target.checked })} /></td>
                  <td><button className="ghost" onClick={() =>
                    up({ income_streams: (s.income_streams ?? []).filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
          </div>
          {hasSideIncome && (
            <MixPanel title="Income Mix" items={incomeMix}
              footer={<>{fmtMoney(grossIncomeNow)}/yr gross · {fmtMoney(employerMatchNow)} employer match</>} />
          )}
        </div>
      </Section>

      <Section
        title="Expenses"
        info="Baseline living costs in today's dollars. Medical spending goes in its own section below; loan payments belong under Debt & Liabilities on the Accounts tab."
        actions={
          <span className="pair">
            <button className="ghost" disabled={s.expense_streams.length < 2}
              title="Reorder the streams largest-first (you can still nudge them with ↑ ↓ after)"
              onClick={sortExpensesByAmount}>Sort By Amount</button>
            <button className="ghost" onClick={() =>
              up({ expense_streams: [...s.expense_streams, {
                name: "New Stream", annual: 0, inflates: true, extra_inflation: 0,
                is_medical: false, essential: false,
              }] })}>+ Add Stream</button>
          </span>
        }>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th><th>$ / Yr</th><th>Ages<InfoTip text={ageRangeTip} /></th>
              <th className="essential-col">Essential<InfoTip text="Essential streams are exempt from guardrail spending cuts." /></th>
              <th className="mixcol">Spending Mix<InfoTip text="Each stream's share of spending active at your current age, in the order you list them. Solid = essential, faded = discretionary." /></th>
              <th /><th />
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
                <td className="essential-col"><input type="checkbox" checked={e.essential}
                  onChange={(ev) => upStream(i, { essential: ev.target.checked })} /></td>
                <td className="mixcell">
                  {activeNow(e.start_age, e.end_age)
                    ? e.annual > 0 && (
                      <span className="mixbar-inline">
                        <span className="mixbar-track">
                          <span className="mixbar-fill" style={{
                            width: `${expMax > 0 ? (e.annual / expMax) * 100 : 0}%`,
                            background: "#58a6ff", opacity: e.essential ? 1 : 0.5 }} />
                        </span>
                        <span className="mixbar-val">{fmtPct(expTotal > 0 ? e.annual / expTotal : 0, 0)}</span>
                      </span>
                    )
                    : e.annual > 0 && (
                      <span className="mix-future">
                        {(e.start_age ?? startAge) > startAge
                          ? `from age ${e.start_age}` : `ended age ${e.end_age}`}
                      </span>
                    )}
                </td>
                <td>
                  <span className="pair">
                    <button className="ghost" disabled={i === 0} onClick={() => moveStream(i, -1)}>↑</button>
                    <button className="ghost" disabled={i === s.expense_streams.length - 1} onClick={() => moveStream(i, 1)}>↓</button>
                  </span>
                </td>
                <td><button className="ghost" onClick={() =>
                  up({ expense_streams: s.expense_streams.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {expTotal > 0 && (
          <div className="table-summary">
            {fmtMoney(expTotal)}/yr active now · {fmtPct(expEssential / expTotal, 0)} essential
            {upcomingExpenses > 0 && ` · ${upcomingExpenses} not active at age ${startAge}`}
          </div>
        )}
      </Section>

      <Section
        title="Life Events"
        info={A.events}
        actions={
          <span className="pair">
            <select value={addKind} onChange={(e) => setAddKind(e.target.value as DisplayKind)}>
              {KIND_ORDER.filter((k) => k !== "crash" && k !== "allocation").map((k) => (
                <option key={k} value={k}>{KIND_META[k].label}</option>
              ))}
            </select>
            <button onClick={() =>
              up({ events: [...s.events,
                newEventOf(addKind, Math.min(startAge + 5, s.profile.horizon_age), s)] })}>
              + Add Event
            </button>
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
            const events = s.events.map((e, j) => (j === index ? { ...e, age, year: null } : e));
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
          <p className="hint">No events yet. Add a house down payment, an inheritance, or a raise — then drag it along the timeline. Allocation glides live on the Accounts tab.</p>
        )}
      </Section>

      {/* ───────────── CASH FLOW OVER TIME ───────────── */}
      <Head id="cf-flow">Cash Flow Over Time</Head>
      <Section title="Account Cash Flow" info={A.accountFlows}>
        {result ? <AccountFlowsChart result={result} axisMode={axisMode}
          retirementAge={s.retirement_age} birthYear={s.profile.birth_year} />
          : <p className="hint">Simulation pending…</p>}
      </Section>

      {/* Snapshot-driven, so the section only appears once a year has been recorded —
          no empty stub on a fresh plan. */}
      {snapshots.some((sn) => sn.spending && Object.values(sn.spending).some((v) => v > 0)) && (
        <Section title="Lifestyle Creep"
          info="Your recorded annual spending by category, converted to today's dollars using the assumed mean inflation, against the dashed line of what your plan budgets. Creep is the bars climbing past the line in real terms.">
          <SpendingActualsChart
            snapshots={snapshots}
            categories={categories}
            inflationMean={s.inflation.mean}
            planTotal={s.expense_streams
              .filter((e) => (e.start_age ?? 0) <= startAge && startAge <= (e.end_age ?? 999))
              .reduce((a, e) => a + e.annual, 0)}
          />
        </Section>
      )}

      {/* ───────────── HEADROOM & RESILIENCE ───────────── */}
      <Head id="cf-headroom">Headroom &amp; Resilience</Head>
      <div className="group-grid stretch headroom">
      <Section title="Income Shock Stress Test" info={A.stressTest} className="span1"
        actions={
          <button className="ghost" onClick={() => runStress(shockAge, shockDur)} disabled={stressLoading}>
            {stressLoading ? "Computing…" : "Recompute"}
          </button>
        }>
        <div className="shock-body">
          <div className="fields shock-inputs">
            <Field label="Shock Starts At Age"
              info="The age your wages drop to zero. Most meaningful before your retirement age.">
              <NumberInput value={shockAge} step={1} min={startAge} max={s.retirement_age} onChange={setShockAge} />
            </Field>
            <Field label="Duration (Years)"
              info="How long wages stay at zero. Fractional is allowed — 0.5 ≈ six months — approximated at the engine's annual grain by earning only the remaining fraction of the final partial year.">
              <NumberInput value={shockDur} step={0.25} min={0.25} max={20} onChange={setShockDur} />
            </Field>
          </div>
          {stress ? (
            <div className="shock-compare">
              <div className="shock-cell">
                <span className="stat-label">Baseline Success</span>
                <span className="stat-value">{fmtPct(stress.base_success)}</span>
                <span className="stat-sub">Retire At {s.retirement_age}</span>
              </div>
              <span className="shock-arrow" aria-hidden="true">→</span>
              <div className="shock-cell">
                <span className="stat-label">After Income Shock</span>
                <span className="stat-value">{fmtPct(stress.stressed_success)}</span>
                <span className="stat-sub">
                  {stress.delta >= 0 ? "+" : ""}{fmtPct(stress.delta)} vs baseline
                </span>
              </div>
            </div>
          ) : (
            <div className="tile-loading"><span className="spinner" />Computing…</div>
          )}
        </div>
      </Section>

      <Section title="Max Sustainable Spending" info={A.maxSpendRetire} className="span1"
        actions={maxspend && (
          <button className="ghost" onClick={runMaxSpend} disabled={maxspendLoading}>
            {maxspendLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        {maxspend ? (
          <div className="stat-row">
            <Stat label="Max Spend Now (While Working)"
              value={`${fmtMoney(maxspend.max_living_annual)}/yr`}
              sub={`${maxspend.max_scale.toFixed(2)}× planned ${fmtMoney(maxspend.base_living_annual)}/yr${maxspend.capped ? " (capped 8×)" : ""}`}
              info={A.maxSpend} />
            <Stat label="Max Spend In Retirement"
              value={`${fmtMoney(maxspend.retirement_max_living_annual)}/yr`}
              sub={`${maxspend.retirement_max_scale.toFixed(2)}× planned · from retirement age ${s.retirement_age}${maxspend.retirement_capped ? " (capped 8×)" : ""}`}
              info={A.maxSpendRetire} />
          </div>
        ) : (
          <div className="tile-loading"><span className="spinner" />Computing…</div>
        )}
      </Section>
      </div>

      {/* ───────────── SPENDING IN RETIREMENT ───────────── */}
      <Head id="cf-retire">Spending In Retirement</Head>
      <HeroRow>
        <HeroStat label="Annual Retirement Spend" value={`${fmtMoney(annualRetSpend)}/yr`}
          sub={`living + net healthcare at age ${s.retirement_age}`} />
        <HeroStat tone="green" label="Spent In Active Years" value={fmtPct(goGoShare, 0)}
          sub="share of lifetime spending through age 75"
          info="Bill-Perkins lens: how much of your modeled lifetime spending lands in the high-energy (active) years through 75 vs later." />
        <HeroStat tone="amber" label="Lifetime Retirement Spending" value={fmtMoney(lifetimeRetSpend)}
          sub={`age ${s.retirement_age}–${s.profile.horizon_age}, today's $`} />
      </HeroRow>

      <Section title="Social Security" info={A.ss}>
        {(() => {
          const ss = s.social_security;
          const estimated = ss.benefit_mode === "estimated";
          const estMonthly = result?.ss_estimated_monthly_at_fra ?? 0;
          const baseMonthly = estimated ? estMonthly : ss.monthly_at_fra;
          return (
        <div className="ss-body">
          <div className="ss-mode">
            <button className={estimated ? "" : "active"}
              onClick={() => up({ social_security: { ...ss, benefit_mode: "manual" } })}>
              From ssa.gov Statement
            </button>
            <button className={estimated ? "active" : ""}
              onClick={() => up({ social_security: { ...ss, benefit_mode: "estimated" } })}>
              Estimate From My Income
            </button>
          </div>
          <div className="ss-cols">
          <div className="ss-controls">
            <div className="fields">
              {estimated ? (
                <>
                  <Field label="Started Working At Age"
                    info="First year you had Social-Security-covered wages. Years between here and your plan's start age are filled with the average beside it (unless a snapshot recorded that year).">
                    <NumberInput value={ss.work_start_age ?? 22} step={1} min={14} max={startAge}
                      onChange={(v) => up({ social_security: { ...ss, work_start_age: v } })} />
                  </Field>
                  <Field label="Avg Earnings Before Plan (Today's $)"
                    info="Your typical covered wages in those pre-plan years, in today's dollars. Recorded snapshot earnings override this for any year you've logged.">
                    <NumberInput value={ss.prior_avg_earnings ?? 0} step={5000} min={0}
                      onChange={(v) => up({ social_security: { ...ss, prior_avg_earnings: v } })} />
                  </Field>
                </>
              ) : (
                <Field label="Monthly Benefit At FRA (Today's $)">
                  <NumberInput value={ss.monthly_at_fra} step={100}
                    onChange={(v) => up({ social_security: { ...ss, monthly_at_fra: v } })} />
                </Field>
              )}
              <Field label="Claiming Age (62–70)">
                <NumberInput value={ss.claiming_age} step={1} min={62} max={70}
                  onChange={(v) => up({ social_security: { ...ss, claiming_age: v } })} />
              </Field>
              <Field label="Haircut (Trust-Fund Scenario)">
                <select value={String(ss.haircut)}
                  onChange={(e) => up({ social_security: { ...ss, haircut: parseFloat(e.target.value) } })}>
                  <option value="1">100% Of Projected</option>
                  <option value="0.75">75%</option>
                  <option value="0.5">50%</option>
                  <option value="0.25">25%</option>
                  <option value="0">0% (None)</option>
                </select>
              </Field>
            </div>
            {estimated ? (
              <div className="ss-estimate-row">
                <Field label="Estimated Monthly At FRA (Today's $)"
                  info="Your gross scheduled benefit at full retirement age (67), before claiming-age adjustment or haircut. Derived from your 35 highest earning years (covered wages, capped at the Social Security max each year), including the $0 years after you retire.">
                  <div className="readout">{result ? fmtMoney(estMonthly) : "…"}</div>
                </Field>
                <p className="hint">
                  Your benefit averages your 35 highest earning years — including the $0
                  years after you retire, which an ssa.gov projection (it assumes you work
                  until FRA) leaves out. That's why this runs lower. The table applies each
                  claiming-age factor and your selected haircut to this figure.
                </p>
              </div>
            ) : (
              <p className="hint">
                Find your estimate at full retirement age on your ssa.gov statement. The
                table applies each claiming-age factor and your selected haircut to it.
              </p>
            )}
          </div>
          <table className="table fit ss-mini">
            <thead>
              <tr><th>Milestone</th><th>Claim At</th><th>Monthly</th><th>Annual</th><th>Vs FRA</th><th>Lifetime To {s.profile.horizon_age}</th></tr>
            </thead>
            <tbody>
              {SS_KEY_CLAIM_AGES.map(({ age, factor, note }) => {
                // what you'd actually receive: FRA benefit × claiming factor × the
                // trust-fund haircut — matching the engine's ss_annual_real.
                const monthly = baseMonthly * factor * (ss.haircut ?? 1);
                const years = Math.max(0, s.profile.horizon_age - age);
                return (
                  <tr key={age}>
                    <td className="ss-note">{note}</td>
                    <td>{age}</td>
                    <td>{fmtMoney(monthly)}</td>
                    <td>{fmtMoney(monthly * 12)}</td>
                    <td className="ss-delta">{factor === 1 ? "—" : `${factor > 1 ? "+" : ""}${Math.round((factor - 1) * 100)}%`}</td>
                    <td>{fmtMoney(monthly * 12 * years)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
          );
        })()}
      </Section>

      <Section title="Spending Strategy" info={A.spendingStrategy}>
        <div className="fields">
          <Field label="Strategy"
            info="How much to spend each retirement year — separate from the Withdrawal Policy (on Accounts), which only chooses which account to tap.">
            <select value={ss.kind}
              onChange={(e) => up({ spending_strategy: { ...ss, kind: e.target.value as any } })}>
              <option value="constant_dollar">Constant Dollar (Plan + Guardrails)</option>
              <option value="constant_pct">Constant % Of Portfolio</option>
              <option value="vpw">Variable % (VPW — Rises With Age)</option>
              <option value="floor_ceiling">Floor &amp; Ceiling (Bounded %)</option>
            </select>
          </Field>
          {(ss.kind === "constant_pct" || ss.kind === "floor_ceiling") && (
            <Field label="Withdrawal Rate (% Of Portfolio)">
              <PercentInput value={ss.rate} step={0.25}
                onChange={(v) => up({ spending_strategy: { ...ss, rate: v } })} />
            </Field>
          )}
          {ss.kind === "vpw" && (
            <Field label="VPW Assumed Real Return">
              <PercentInput value={ss.vpw_real_return} step={0.25}
                onChange={(v) => up({ spending_strategy: { ...ss, vpw_real_return: v } })} />
            </Field>
          )}
          {ss.kind === "floor_ceiling" && (
            <>
              <Field label="Floor (% Of Plan Discretionary)">
                <PercentInput value={ss.floor_mult} step={5}
                  onChange={(v) => up({ spending_strategy: { ...ss, floor_mult: v } })} />
              </Field>
              <Field label="Ceiling (% Of Plan Discretionary)">
                <PercentInput value={ss.ceiling_mult} step={5}
                  onChange={(v) => up({ spending_strategy: { ...ss, ceiling_mult: v } })} />
              </Field>
            </>
          )}
        </div>
        <p className="hint">{{
          constant_dollar: "Spends your planned expense streams every year. With guardrails on (below), discretionary spending is trimmed when your withdrawal rate runs hot and restored when markets recover — bounded by the floor and ceiling.",
          constant_pct: "Each year, discretionary spending = your rate × current portfolio, after essentials are covered. It self-corrects with the market and can never deplete to zero, but income swings year to year. If the rate is low relative to your essentials, discretionary can fall to near zero — which is why spending can look thin on the other tabs.",
          vpw: "Like Constant %, but the rate rises with age via an annuity payout factor, deliberately drawing the balance toward zero by your horizon. A higher assumed real return pulls more spending into your earlier years.",
          floor_ceiling: "Constant % bounded between a floor and ceiling of your planned discretionary spend — keeps the market self-correction but guarantees a minimum lifestyle (and caps the upside).",
        }[ss.kind]}</p>
        {result && retIdx >= 0 && (
          <p className="hint">
            At retirement (age {s.retirement_age}), this funds ≈ <strong>{fmtMoney(modeledRetSpend)}/yr</strong>{" "}
            of living + medical on the median path{plannedAtRet > 0 ? ` (planned ${fmtMoney(plannedAtRet)}/yr)` : ""}.
            {modeledRetSpend > 0 && plannedAtRet > 0 && modeledRetSpend < plannedAtRet * 0.85 &&
              " It's funding noticeably less than planned — raise the rate, or switch to Constant Dollar if that wasn't intended."}
          </p>
        )}
        {ss.kind === "constant_dollar" ? (
          <div className="fields">
            <Field label="Guardrails Enabled" info={A.guardrails}>
              <input type="checkbox" checked={s.guardrails.enabled}
                onChange={(e) => up({ guardrails: { ...s.guardrails, enabled: e.target.checked } })} />
            </Field>
            <Field label="Guard Band (± Around Initial Rate)">
              <PercentInput value={s.guardrails.band} step={5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, band: v } })} />
            </Field>
            <Field label="Cut Step">
              <PercentInput value={s.guardrails.cut} step={2.5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, cut: v } })} />
            </Field>
            <Field label="Restore Step">
              <PercentInput value={s.guardrails.boost} step={2.5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, boost: v } })} />
            </Field>
            <Field label="Floor (Min % Of Planned Discretionary)">
              <PercentInput value={s.guardrails.floor_mult} step={5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, floor_mult: v } })} />
            </Field>
            <Field label="Ceiling (Max % Of Planned Discretionary)">
              <PercentInput value={s.guardrails.cap_mult} step={5}
                onChange={(v) => up({ guardrails: { ...s.guardrails, cap_mult: v } })} />
            </Field>
          </div>
        ) : (
          <p className="hint">This portfolio-percentage strategy replaces the guardrails: discretionary spending tracks your balance each year (essentials always funded first).</p>
        )}
      </Section>

      {/* ───────────── HEALTHCARE ───────────── */}
      <Head id="cf-health">Healthcare</Head>
      <HeroRow>
        <HeroStat tone="purple" label="Lifetime Net Healthcare" value={fmtMoney(lifetimeHc)}
          sub="premiums − subsidy + IRMAA, today's $"
          info="Sum of modeled net healthcare cost over the plan (median path). Zero until you enable ACA (below) or IRMAA (Taxes tab)." />
        <HeroStat tone="purple" label="Peak Annual Net Cost" value={fmtMoney(peakHc)}
          sub={peakHcAge ? `at age ${peakHcAge}` : "enable ACA / IRMAA to model"} />
        <HeroStat tone="green" label="ACA Subsidy Captured" value={fmtMoney(subCaptured)}
          sub="lifetime, today's $" />
      </HeroRow>

      <div className="group-grid stretch">
      <Section
        title="Medical Spending (HSA-Eligible)"
        className="span1"
        info="Out-of-pocket medical spending, kept separate from general expenses. Always essential; the HSA pays its share (set utilization under HSA on the Accounts tab). Don't list insurance premiums here — those are modeled under ACA / IRMAA, which add on top."
        actions={
          <button className="ghost" onClick={() =>
            up({ medical_streams: [...(s.medical_streams ?? []), {
              name: "Out-Of-Pocket Medical", annual: 0, inflates: true, extra_inflation: 0,
              is_medical: false, essential: true,
            }] })}>+ Add Medical</button>
        }>
        {(s.medical_streams ?? []).length > 0 ? (
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
                    –
                    <NumberInput value={e.end_age ?? s.profile.horizon_age} step={1}
                      onChange={(v) => upMedical(i, { end_age: v })} />
                  </td>
                  <td className="cpicell"><PercentInput value={e.extra_inflation} step={0.25}
                    onChange={(v) => upMedical(i, { extra_inflation: v })} /></td>
                  <td><button className="ghost" onClick={() =>
                    up({ medical_streams: (s.medical_streams ?? []).filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">No medical streams yet. Add prescriptions, dental, copays — the spending your HSA is meant to cover.</p>
        )}
      </Section>

      <Section title="ACA Premium Subsidy (Pre-65)" info={A.aca} className="span1">
        <div className="fields">
          <Field label="Enabled">
            <input type="checkbox" checked={s.aca.enabled}
              onChange={(e) => up({ aca: { ...s.aca, enabled: e.target.checked } })} />
          </Field>
          <Field label="Benchmark Premium (Today's $/yr)"
            info="The second-lowest-cost Silver plan in your area — the plan the subsidy is computed against.">
            <NumberInput value={s.aca.benchmark_annual} step={500}
              onChange={(v) => up({ aca: { ...s.aca, benchmark_annual: v } })} />
          </Field>
          <Field label="Your Plan's Premium (Today's $/yr)">
            <NumberInput value={s.aca.actual_annual} step={500}
              onChange={(v) => up({ aca: { ...s.aca, actual_annual: v } })} />
          </Field>
          <Field label="Coverage Ends At Age"
            info="Medicare eligibility — marketplace coverage (and this subsidy) stops here.">
            <NumberInput value={s.aca.coverage_end_age} step={1}
              onChange={(v) => up({ aca: { ...s.aca, coverage_end_age: v } })} />
          </Field>
        </div>
        <p className="hint">
          <strong>What the subsidy is:</strong> if you retire before 65 you buy insurance on the ACA marketplace,
          and the government caps what you're expected to pay for a benchmark plan at a sliding share of income
          (up to 8.5% of MAGI, no cliff). The subsidy is benchmark premium minus that expected share, which lowers
          your premium. Off by default because the two premium numbers depend on your age and area —
          look them up with HealthCare.gov's window-shopping tool, then enable.
        </p>
        <p className="hint">Roth conversions and capital gains raise MAGI and shrink the subsidy — the collision the Accounts tab's subsidy-vs-conversion view surfaces. Don't also list this premium as an expense stream.</p>
      </Section>
      </div>

      <Section title="Net Healthcare Cost" info={A.healthcareTrajectory}>
        {result ? (
          result.healthcare?.net_cost_real?.some((v) => v > 1)
            || result.healthcare?.subsidy_real?.some((v) => v > 1) ? (
            <HealthcareCostChart result={result} axisMode={axisMode}
              retirementAge={s.retirement_age} coverageEndAge={s.aca.coverage_end_age}
              birthYear={s.profile.birth_year} />
          ) : (
            <p className="hint">
              No modeled healthcare cost yet. Turn on ACA Premium Subsidy above (pre-65) or
              IRMAA on the Taxes tab (65+) to see net premium, subsidy, and surcharge over life.
            </p>
          )
        ) : <p className="hint">Simulation pending…</p>}
      </Section>
    </div>
  );
}
