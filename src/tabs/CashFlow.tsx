import React, { useState } from "react";
import { A } from "../assumptions";
import {
  ContributionsChart, FulfillmentChart, FundingSourceChart, HealthcareCostChart,
  RetirementSpendingChart, SpendingActualsChart, SpendingDepthChart,
} from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import {
  Collapsible, Field, InfoTip, NumberInput, PercentInput, Section, SectionNav, Stat,
  fmtMoney, fmtPct,
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

/** One editable row in the Life Events list. The crash/allocation branches stay
 * editable for existing events, but both are dropped from the add menu (better
 * stress tools live on Freedom; allocation glides live on Accounts). */
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
  const [shockDur, setShockDur] = useState(3);
  const [goGoEnd, setGoGoEnd] = useState(75);
  const [enjoyFloor, setEnjoyFloor] = useState(0.3);

  const upStream = (i: number, patch: Partial<ExpenseStream>) =>
    up({ expense_streams: s.expense_streams.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const moveStream = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.expense_streams.length) return;
    const expense_streams = [...s.expense_streams];
    [expense_streams[i], expense_streams[j]] = [expense_streams[j], expense_streams[i]];
    up({ expense_streams });
  };
  const upMedical = (i: number, patch: Partial<ExpenseStream>) =>
    up({ medical_streams: (s.medical_streams ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const upIncome = (i: number, patch: Partial<IncomeStream>) =>
    up({ income_streams: (s.income_streams ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const ss = s.spending_strategy;

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "cf-overview", label: "Overview" },
        { id: "cf-health", label: "Healthcare" },
        { id: "cf-retire", label: "Retirement" },
      ]} />

      {/* ───────────── OVERVIEW ───────────── */}
      <Head id="cf-overview">Overview</Head>
      <Section title="Income"
        info="Salary in today's dollars; the primary salary stops at retirement unless a New Salary event sets another. Add other streams below for side income.">
        <div className="fields">
          <Field label="Primary Gross Salary">
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
          <table className="table">
            <thead><tr><th>Name</th><th>$ / Yr</th><th>Ages</th><th>Raise / Yr</th><th>Volatility</th><th /></tr></thead>
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
                  <td><button className="ghost" onClick={() =>
                    up({ income_streams: (s.income_streams ?? []).filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Expenses"
        info="Baseline living costs in today's dollars. Medical spending goes in its own section below; loan payments belong under Debt & Liabilities on the Accounts tab."
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
              <th>Name</th><th>$ / Yr</th><th>Ages</th>
              <th>CPI +<InfoTip text={A.cpiPlus} /></th>
              <th>Inflates<InfoTip text={A.inflatesFlag} /></th>
              <th>Essential<InfoTip text="Essential streams are exempt from guardrail spending cuts." /></th>
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
                <td className="cpicell"><PercentInput value={e.extra_inflation} step={0.25}
                  onChange={(v) => upStream(i, { extra_inflation: v })} /></td>
                <td><input type="checkbox" checked={e.inflates}
                  onChange={(ev) => upStream(i, { inflates: ev.target.checked })} /></td>
                <td><input type="checkbox" checked={e.essential}
                  onChange={(ev) => upStream(i, { essential: ev.target.checked })} /></td>
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

      <Section title="Lifestyle Creep"
        info="Your recorded annual spending by category, converted to today's dollars using the assumed mean inflation, against the dashed line of what your plan budgets. Creep is the bars climbing past the line in real terms.">
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
            No spending recorded yet. Use Record A Snapshot on the Accounts tab and fill the Annual
            Spending section — once a year is enough to see the trend.
          </p>
        )}
      </Section>

      <Section title="Income Shock Stress Test" info={A.stressTest}>
        <div className="fields">
          <Field label="Shock Starts At Age"
            info="The age your wages drop to zero. Most meaningful before your retirement age.">
            <NumberInput value={shockAge} step={1} min={startAge} max={s.retirement_age} onChange={setShockAge} />
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

      <Section title="Max Sustainable Spending" info={A.maxSpendRetire}
        actions={maxspend && (
          <button className="ghost" onClick={runMaxSpend} disabled={maxspendLoading}>
            {maxspendLoading ? "Computing…" : "Recompute"}
          </button>
        )}>
        {maxspend ? (
          <div className="stat-grid">
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
          <button onClick={runMaxSpend} disabled={maxspendLoading}>
            {maxspendLoading ? "Computing…" : "Compute"}
          </button>
        )}
      </Section>

      <Section title="Funding Sources — Work vs Accounts" info={A.withdrawalSource}>
        {result ? <FundingSourceChart result={result} axisMode={axisMode} />
          : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Annual Contributions" info={A.investing}>
        {result ? <ContributionsChart result={result} axisMode={axisMode} />
          : <p className="hint">Simulation pending…</p>}
      </Section>

      {/* ───────────── HEALTHCARE ───────────── */}
      <Head id="cf-health">Healthcare</Head>
      <Section
        title="Medical Spending (HSA-Eligible)"
        info="Out-of-pocket medical spending, kept separate from general expenses. Always essential; the HSA pays its share (set utilization under HSA on the Accounts tab). Don't list insurance premiums here — those are modeled under ACA / IRMAA, which add on top."
        actions={
          <button className="ghost" onClick={() =>
            up({ medical_streams: [...(s.medical_streams ?? []), {
              name: "Out-Of-Pocket Medical", annual: 0, inflates: true, extra_inflation: 0,
              is_medical: false, essential: true,
            }] })}>+ Add Medical</button>
        }>
        {(s.medical_streams ?? []).length > 0 ? (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>$ / Yr</th><th>Ages</th>
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

      <Collapsible title="ACA Premium Subsidy (Pre-65)" info={A.aca}>
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
        <p className="hint">Models the post-2021 subsidy (caps at 8.5% of MAGI, no income cliff). Roth conversions raise MAGI and shrink the subsidy — the collision the Accounts tab's subsidy-vs-conversion view surfaces. Don't also list this premium as an expense stream.</p>
      </Collapsible>

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

      {/* ───────────── RETIREMENT ───────────── */}
      <Head id="cf-retire">Retirement</Head>
      <Section title="Retirement Spending"
        info="What a year in retirement costs on the median path: living expenses plus net healthcare (ACA premium after subsidy, then IRMAA at 65+).">
        {result ? (
          <RetirementSpendingChart result={result} axisMode={axisMode}
            retirementAge={s.retirement_age} coverageEndAge={s.aca.coverage_end_age}
            birthYear={s.profile.birth_year} />
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      <Collapsible title="Social Security" info={A.ss}>
        <div className="fields">
          <Field label="Monthly Benefit At FRA (Today's $)">
            <NumberInput value={s.social_security.monthly_at_fra} step={100}
              onChange={(v) => up({ social_security: { ...s.social_security, monthly_at_fra: v } })} />
          </Field>
          <Field label="Claiming Age (62–70)">
            <NumberInput value={s.social_security.claiming_age} step={1} min={62} max={70}
              onChange={(v) => up({ social_security: { ...s.social_security, claiming_age: v } })} />
          </Field>
          <Field label="Haircut (Trust-Fund Scenario)">
            <select value={String(s.social_security.haircut)}
              onChange={(e) => up({ social_security: { ...s.social_security, haircut: parseFloat(e.target.value) } })}>
              <option value="1">100% Of Projected</option>
              <option value="0.75">75%</option>
              <option value="0.5">50%</option>
              <option value="0.25">25%</option>
              <option value="0">0% (None)</option>
            </select>
          </Field>
        </div>
        <p className="hint">
          Benefit is income; how it's taxed (the provisional-income "torpedo") is on the Taxes tab.{" "}
          <a className="ext" href="https://www.ssa.gov/myaccount/" target="_blank" rel="noreferrer">Estimate your benefit at ssa.gov ↗</a>
        </p>
      </Collapsible>

      <Collapsible title="Spending Strategy" info={A.spendingStrategy} defaultOpen>
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
      </Collapsible>

      <Section title="Spending vs Ability To Enjoy It" info={A.fulfillment}>
        {result ? (() => {
          const ages = result.ages;
          const spend = result.expenses_median_real;
          const total = spend.reduce((a, b) => a + b, 0);
          const shareWhere = (pred: (age: number) => boolean) =>
            total > 0 ? spend.reduce((acc, v, i) => acc + (pred(ages[i]) ? v : 0), 0) / total : 0;
          const goGo = shareWhere((a) => a <= goGoEnd);
          const slowGo = shareWhere((a) => a > goGoEnd && a <= 85);
          const noGo = shareWhere((a) => a > 85);
          return (
            <>
              <div className="fields">
                <Field label="Go-Go Years End At Age"
                  info="Through this age a dollar buys full enjoyment; after it, enjoyment tapers as health and energy fade.">
                  <NumberInput value={goGoEnd} step={1} min={s.retirement_age} max={90} onChange={setGoGoEnd} />
                </Field>
                <Field label="Late-Life Enjoyment Floor"
                  info="How much a dollar is still worth from age 90 on, relative to the go-go years. Perkins' rough default is 30%.">
                  <PercentInput value={enjoyFloor} step={5} onChange={setEnjoyFloor} />
                </Field>
              </div>
              <div className="stat-grid">
                <Stat label="Spent In Go-Go Years" value={fmtPct(goGo, 0)} sub={`through age ${goGoEnd}`} info={A.fulfillment} />
                <Stat label="Slow-Go" value={fmtPct(slowGo, 0)} sub={`${goGoEnd + 1}–85`} />
                <Stat label="No-Go" value={fmtPct(noGo, 0)} sub="86+" />
              </div>
              <FulfillmentChart result={result} axisMode={axisMode}
                retirementAge={s.retirement_age} birthYear={s.profile.birth_year}
                goGoEnd={goGoEnd} floor={enjoyFloor} />
            </>
          );
        })() : <p className="hint">Simulation pending…</p>}
      </Section>

      {(s.spending_strategy.kind !== "constant_dollar" || s.guardrails.enabled) && (
        <Section title="Realized Spending Level" info={A.spendingDepth}>
          {result ? (
            <SpendingDepthChart result={result} axisMode={axisMode} retirementAge={s.retirement_age}
              enabled={s.spending_strategy.kind !== "constant_dollar" || s.guardrails.enabled}
              floor={s.spending_strategy.kind === "floor_ceiling" ? s.spending_strategy.floor_mult
                : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.floor_mult : 0}
              cap={s.spending_strategy.kind === "floor_ceiling" ? s.spending_strategy.ceiling_mult
                : s.spending_strategy.kind === "constant_dollar" ? s.guardrails.cap_mult : 0}
              birthYear={s.profile.birth_year} />
          ) : <p className="hint">Simulation pending…</p>}
        </Section>
      )}
    </div>
  );
}
