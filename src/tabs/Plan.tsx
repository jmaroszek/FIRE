import React, { useState } from "react";
import { A } from "../assumptions";
import { WithdrawalSourceChart } from "../components/charts";
import TimelineEditor from "../components/TimelineEditor";
import {
  Collapsible, Field, Group, InfoTip, NumberInput, PercentInput, Section, fmtMoney,
} from "../components/ui";
import { KIND_META, KIND_ORDER, displayKindOf, newEventOf, type DisplayKind } from "../events";
import { ACCOUNT_LABELS, SOURCE_LABELS } from "../labels";
import { useStore } from "../store";
import type {
  Account, AccountType, ExpenseStream, FireEvent, IncomeStream, Liability, Scenario,
  WaterfallStep, WithdrawalSource,
} from "../types";

const DEFAULT_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "roth_basis", "roth_matured_conversions", "trad", "hsa", "roth_earnings"];
const DEFAULT_LATE_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "trad", "hsa", "roth_matured_conversions", "roth_basis", "roth_earnings"];

/** One editable row in the Life Events list. Relocated from the old Cash Flow tab;
 * the crash branch is kept so existing crash events stay editable, but "crash" is
 * dropped from the add menu (better stress tools live on the Risk tab). */
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

/** A contribution-waterfall step list (account / amount / reorder / remove),
 * reused by the base waterfall and each scheduled phase. */
function WaterfallTable({ steps, onChange }: {
  steps: WaterfallStep[]; onChange: (steps: WaterfallStep[]) => void;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <table className="table">
      <thead><tr><th>#</th><th>Account</th><th>Amount</th><th /><th /></tr></thead>
      <tbody>
        {steps.map((w, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>
              <select value={w.account} onChange={(e) => {
                const account = e.target.value as AccountType;
                onChange(steps.map((x, j) => j === i ? {
                  ...x, account,
                  kind: x.kind === "to_match" && account !== "trad_401k" ? "max" : x.kind,
                } : x));
              }}>
                {Object.entries(ACCOUNT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </td>
            <td>
              <span className="pair">
                <select value={w.kind} onChange={(e) =>
                  onChange(steps.map((x, j) => j === i ? { ...x, kind: e.target.value as WaterfallStep["kind"] } : x))}>
                  {w.account === "trad_401k" && <option value="to_match">To Match</option>}
                  <option value="max">
                    {w.account === "taxable" || w.account === "cash" ? "Spillover" : "Max"}
                  </option>
                  <option value="fixed">Fixed $</option>
                </select>
                {w.kind === "fixed" && (
                  <NumberInput value={w.amount ?? 0} step={500}
                    onChange={(v) => onChange(steps.map((x, j) => j === i ? { ...x, amount: v } : x))} />
                )}
              </span>
            </td>
            <td>
              <span className="pair">
                <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              </span>
            </td>
            <td><button className="ghost" onClick={() => onChange(steps.filter((_, j) => j !== i))}>✕</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Plan() {
  const { scenario, result, axisMode } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [addKind, setAddKind] = useState<DisplayKind>("expense");
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;

  // ---- collection update helpers
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
  const upAccount = (i: number, patch: Partial<Account>) =>
    up({ accounts: s.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const upLiability = (i: number, patch: Partial<Liability>) =>
    up({ liabilities: (s.liabilities ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const payoffAge = (l: Liability): number | null => {
    const begin = l.start_age != null && l.start_age > startAge ? l.start_age : startAge;
    let bal = l.balance;
    for (let t = 0; t < 80; t++) {
      if (bal <= 1e-9) return begin + t;
      bal *= 1 + l.interest_rate;
      bal -= Math.min(l.annual_payment, bal);
    }
    return null;
  };
  const ss = s.spending_strategy;

  return (
    <div className="stack">
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
        info="Baseline living costs in today's dollars. Medical spending goes in its own section below; loan payments belong under Debt & Liabilities."
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
        title="Medical Spending (HSA-Eligible)"
        info="Out-of-pocket medical spending, kept separate from general expenses. Always essential; the HSA pays its share (set utilization under HSA below). Don't list insurance premiums here — those are modeled under ACA / IRMAA, which add on top."
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

      <Section
        title="Life Events"
        info={A.events}
        actions={
          <span className="pair">
            <select value={addKind} onChange={(e) => setAddKind(e.target.value as DisplayKind)}>
              {KIND_ORDER.filter((k) => k !== "crash").map((k) => (
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
          <p className="hint">No events yet. Add a house down payment, an inheritance, a raise, or an allocation shift — then drag it along the timeline.</p>
        )}
      </Section>

      <Section
        title="Accounts"
        info="Balances merge into five tax pools: brokerage, traditional, Roth, HSA, cash."
        actions={
          <select className="add-select" value="" onChange={(e) => {
            if (!e.target.value) return;
            up({ accounts: [...s.accounts, { type: e.target.value as AccountType, balance: 0 }] });
          }}>
            <option value="">+ Add Account</option>
            {Object.entries(ACCOUNT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        }>
        <table className="table">
          <thead>
            <tr><th>Account</th><th>Balance</th>
              <th>Basis<InfoTip text={`Brokerage: ${A.costBasis} — Roth: ${A.rothBasis}`} /></th><th /></tr>
          </thead>
          <tbody>
            {s.accounts.map((a, i) => (
              <tr key={i}>
                <td>{ACCOUNT_LABELS[a.type]}</td>
                <td><NumberInput value={a.balance} step={1000} onChange={(v) => upAccount(i, { balance: v })} /></td>
                <td>
                  {a.type === "taxable" && (
                    <NumberInput value={a.cost_basis ?? a.balance} step={1000}
                      onChange={(v) => upAccount(i, { cost_basis: v })} />
                  )}
                  {(a.type === "roth_ira" || a.type === "roth_401k") && (
                    <NumberInput value={a.roth_contribution_basis ?? 0} step={1000}
                      onChange={(v) => upAccount(i, { roth_contribution_basis: v })} />
                  )}
                </td>
                <td><button className="ghost" onClick={() =>
                  up({ accounts: s.accounts.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
                <th>Name</th><th>Balance</th><th>Rate</th><th>Payment / Yr</th>
                <th>Starts At<InfoTip text="Leave at your current age for present-day debt. Set a future age to schedule a loan you haven't taken yet — e.g. a mortgage — so its payments (and the expense drop at payoff) land in the right years." /></th>
                <th>Paid Off<InfoTip text="Estimated age the amortization reaches zero. — means the payment doesn't cover interest." /></th>
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
                  <td><NumberInput value={l.start_age ?? startAge} step={1} min={startAge}
                    onChange={(v) => upLiability(i, { start_age: v <= startAge ? null : v })} /></td>
                  <td>{payoffAge(l) != null ? `Age ${payoffAge(l)}` : "—"}</td>
                  <td><button className="ghost" onClick={() =>
                    up({ liabilities: (s.liabilities ?? []).filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">Mortgage, car loan, business loans. Payments count as essential non-inflating expenses; the outstanding balance reduces net worth.</p>
        )}
      </Section>

      <Collapsible title="Contributions: Waterfall & Schedule" info={A.waterfall}
        actions={
          <button className="ghost" onClick={() =>
            up({ waterfall: [...s.waterfall, { account: "taxable", kind: "max" }] })}>+ Step</button>
        }>
        <p className="hint" style={{ marginTop: 0 }}>Surplus each year flows down this list. Add phases below to change the routing at chosen ages — e.g. divert from the 401k to taxable while saving for a house.</p>
        <WaterfallTable steps={s.waterfall} onChange={(waterfall) => up({ waterfall })} />
        <div className="card-head" style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>Phases (Age-Keyed Overrides)</h3>
          <button className="ghost" onClick={() =>
            up({ waterfall_schedule: [...(s.waterfall_schedule ?? []),
              { start_age: Math.min(startAge + 5, s.profile.horizon_age), steps: s.waterfall }] })}>
            + Add Phase
          </button>
        </div>
        {(s.waterfall_schedule ?? []).map((seg, si) => (
          <div key={si} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <div className="pair" style={{ marginBottom: 6 }}>
              <Field label="From Age">
                <NumberInput value={seg.start_age} step={1}
                  onChange={(v) => up({ waterfall_schedule: (s.waterfall_schedule ?? []).map((x, j) => j === si ? { ...x, start_age: v } : x) })} />
              </Field>
              <button className="ghost" onClick={() =>
                up({ waterfall_schedule: (s.waterfall_schedule ?? []).filter((_, j) => j !== si) })}>
                ✕ Remove Phase
              </button>
            </div>
            <WaterfallTable steps={seg.steps}
              onChange={(steps) => up({ waterfall_schedule: (s.waterfall_schedule ?? []).map((x, j) => j === si ? { ...x, steps } : x) })} />
          </div>
        ))}
      </Collapsible>

      <Collapsible title="HSA Settings" info={A.hsa}>
        <div className="fields">
          <Field label="Utilization"
            info={"The share of HSA-eligible medical spending paid tax-free from the HSA each year; the rest is paid out of pocket."}>
            <PercentInput value={s.hsa.utilization} step={5}
              onChange={(v) => up({ hsa: { ...s.hsa, utilization: v } })} />
          </Field>
          <Field label="Cash Buffer" info={A.hsaBuffer}>
            <NumberInput value={s.hsa.cash_buffer} step={500}
              onChange={(v) => up({ hsa: { ...s.hsa, cash_buffer: v } })} />
          </Field>
          <Field label="Coverage">
            <select value={s.hsa.coverage}
              onChange={(e) => up({ hsa: { ...s.hsa, coverage: e.target.value as any } })}>
              <option value="self_only">Self-Only</option>
              <option value="family">Family</option>
            </select>
          </Field>
        </div>
      </Collapsible>

      <Collapsible title="Market Model & Allocation" info={A.cagr}>
        <div className="fields">
          <Field label="Mode" info={A.bootstrap}>
            <select value={s.market.mode}
              onChange={(e) => up({ market: { ...s.market, mode: e.target.value as any } })}>
              <option value="bootstrap">Historical Bootstrap</option>
              <option value="parametric">Parametric (Lognormal)</option>
            </select>
          </Field>
          <Field label="Stocks (CAGR / Vol)" info={A.vol}>
            <span className="pair">
              <PercentInput value={s.market.stocks.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, real_cagr: v } } })} />
              <PercentInput value={s.market.stocks.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, vol: v } } })} />
            </span>
          </Field>
          <Field label="Bonds (CAGR / Vol)" info={A.vol}>
            <span className="pair">
              <PercentInput value={s.market.bonds.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, real_cagr: v } } })} />
              <PercentInput value={s.market.bonds.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, vol: v } } })} />
            </span>
          </Field>
        </div>
        <div className="fields">
          <Field label="Allocation (Stocks / Bonds / Cash)"
            info="Portfolio weights. One global allocation across all accounts.">
            <span className="pair">
              <PercentInput value={s.allocation.stocks} step={5}
                onChange={(v) => up({ allocation: { ...s.allocation, stocks: v, bonds: Math.max(0, 1 - v - s.allocation.cash) } })} />
              <PercentInput value={s.allocation.bonds} step={5}
                onChange={(v) => up({ allocation: { ...s.allocation, bonds: v, stocks: Math.max(0, 1 - v - s.allocation.cash) } })} />
              <PercentInput value={s.allocation.cash} step={1}
                onChange={(v) => up({ allocation: { ...s.allocation, cash: v, stocks: Math.max(0, 1 - v - s.allocation.bonds) } })} />
            </span>
          </Field>
          <Field label="Mean Shift"
            info="Bootstrap mode only: shifts historical returns so their long-run average matches your entered CAGRs, keeping history's volatility and correlations.">
            <input type="checkbox" checked={s.market.bootstrap_mean_shift}
              onChange={(e) => up({ market: { ...s.market, bootstrap_mean_shift: e.target.checked } })} />
          </Field>
        </div>
      </Collapsible>

      <Collapsible title="Inflation" info={A.inflation}>
        <div className="fields">
          <Field label="Mean">
            <PercentInput value={s.inflation.mean} step={0.25}
              onChange={(v) => up({ inflation: { ...s.inflation, mean: v } })} />
          </Field>
          <Field label="Persistence (AR1)">
            <NumberInput value={s.inflation.persistence} step={0.05} min={0} max={0.95}
              onChange={(v) => up({ inflation: { ...s.inflation, persistence: v } })} />
          </Field>
          <Field label="Volatility">
            <PercentInput value={s.inflation.sigma} step={0.25}
              onChange={(v) => up({ inflation: { ...s.inflation, sigma: v } })} />
          </Field>
        </div>
        <p className="hint">Bootstrap mode samples inflation jointly with returns from history; these AR(1) settings apply to parametric mode.</p>
      </Collapsible>

      <Collapsible title="Withdrawal Policy" info={A.policy} defaultOpen={false}>
        <div className="policy-row">
          {(["order", "late_order"] as const).map((which) => {
            const list = s.withdrawal_policy[which]
              ?? (which === "order" ? DEFAULT_ORDER : DEFAULT_LATE_ORDER);
            const move = (i: number, dir: -1 | 1) => {
              const j = i + dir;
              if (j < 0 || j >= list.length) return;
              const next = [...list];
              [next[i], next[j]] = [next[j], next[i]];
              up({ withdrawal_policy: { ...s.withdrawal_policy, [which]: next } });
            };
            return (
              <div className="policy-col" key={which}>
                <div className="policy-col-head">{which === "order" ? "Before 59½" : "59½ & After"}</div>
                <ol className="policy-list">
                  {list.map((src, i) => (
                    <li key={src}>
                      {SOURCE_LABELS[src]}
                      <span>
                        <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                        <button className="ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
          <div className="fields">
            <Field label="Cash Buffer"
              info="The withdrawal policy never draws the cash pool below this amount — your untouchable reserve.">
              <NumberInput value={s.withdrawal_policy.cash_buffer} step={1000}
                onChange={(v) => up({ withdrawal_policy: { ...s.withdrawal_policy, cash_buffer: v } })} />
            </Field>
            <Field label="Last Resort: Early Trad + Penalty"
              info="If every other source is empty before 59½, tap traditional early and pay the 10% penalty rather than miss a year. Note: relying on this now counts as a FAILURE — it only changes how a failed path keeps going, not the success rate.">
              <input type="checkbox" checked={s.withdrawal_policy.allow_early_trad_with_penalty}
                onChange={(e) => up({ withdrawal_policy: { ...s.withdrawal_policy, allow_early_trad_with_penalty: e.target.checked } })} />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="card-head"><h3 style={{ fontSize: 13, margin: 0 }}>
            Spending Funded By Source<InfoTip text={A.withdrawalSource} />
          </h3></div>
          {result ? <WithdrawalSourceChart result={result} axisMode={axisMode} />
            : <p className="hint">Simulation pending…</p>}
        </div>
      </Collapsible>

      <Collapsible title="Spending Strategy" info={A.spendingStrategy}>
        <div className="fields">
          <Field label="Strategy"
            info="How much to spend each retirement year — separate from the Withdrawal Policy, which only chooses which account to tap.">
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
        <p className="hint">Models the post-2021 subsidy (caps at 8.5% of MAGI, no income cliff). Roth conversions raise MAGI and shrink the subsidy. Don't also list this premium as an expense stream.</p>
      </Collapsible>

      <Collapsible title="IRMAA Medicare Surcharge (65+)" info={A.irmaa}>
        <div className="fields">
          <Field label="Enabled">
            <input type="checkbox" checked={s.irmaa.enabled}
              onChange={(e) => up({ irmaa: { ...s.irmaa, enabled: e.target.checked } })} />
          </Field>
        </div>
        <p className="hint">Uses the 2025 single-filer Part B + D tiers (the surcharge starts above ~$106k MAGI). A high Roth-conversion or RMD year can trip a tier — cross-check the ladder and RMD tables on the Accounts &amp; Taxes tab.</p>
      </Collapsible>

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
          <a className="ext" href="https://www.ssa.gov/myaccount/" target="_blank" rel="noreferrer">Estimate your benefit at ssa.gov ↗</a>
        </p>
      </Collapsible>
    </div>
  );
}
