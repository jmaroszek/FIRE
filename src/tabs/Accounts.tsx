import React, { useState } from "react";
import { A } from "../assumptions";
import {
  AccessibilityChart, HistogramChart, SeriesChart,
  SubsidyConversionChart, WealthFlowsChart,
} from "../components/charts";
import {
  Collapsible, Field, HeroRow, HeroStat, InfoTip, NumberInput, PercentInput,
  Section, SectionNav, Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { ACCOUNT_LABELS, SOURCE_LABELS } from "../labels";
import { useStore } from "../store";
import type {
  Account, AccountType, Liability, Scenario, WaterfallStep, WithdrawalSource,
} from "../types";

const POOLS = ["taxable", "trad", "roth", "hsa", "cash"] as const;
const POOL_LABELS: Record<string, string> = {
  taxable: "Taxable", trad: "Traditional", roth: "Roth", hsa: "HSA", cash: "Cash",
};
const DEFAULT_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "roth_basis", "roth_matured_conversions", "trad", "hsa", "roth_earnings"];
const DEFAULT_LATE_ORDER: WithdrawalSource[] =
  ["cash", "taxable", "trad", "hsa", "roth_matured_conversions", "roth_basis", "roth_earnings"];

function poolBalances(accounts: { type: string; balance: number }[]) {
  const out: Record<string, number> = { taxable: 0, trad: 0, roth: 0, hsa: 0, cash: 0 };
  for (const a of accounts) {
    const pool =
      a.type === "taxable" ? "taxable"
      : a.type === "cash" ? "cash"
      : a.type === "hsa" ? "hsa"
      : a.type.startsWith("trad") ? "trad" : "roth";
    out[pool] += a.balance;
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pctile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

/** A contribution-waterfall step list (account / amount / reorder / remove). */
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

type Alloc = { stocks: number; bonds: number; cash: number };

/** One allocation mix as a vertical table (Asset Class / Weight). Rendered for
 * the base mix and for each glidepath phase, laid out side-by-side. */
function AllocTable({ alloc, onChange, head, className }: {
  alloc: Alloc; onChange: (a: Alloc) => void; head: React.ReactNode; className?: string;
}) {
  const total = alloc.stocks + alloc.bonds + alloc.cash;
  return (
    <div className={["glide-col", className ?? ""].join(" ").trim()}>
      <div className="glide-col-head">{head}</div>
      <table className="table">
        <thead><tr><th>Asset Class</th><th style={{ textAlign: "right" }}>Weight</th></tr></thead>
        <tbody>
          <tr>
            <td>Stocks</td>
            <td style={{ textAlign: "right" }}>
              <PercentInput value={alloc.stocks} step={5}
                onChange={(v) => onChange({ stocks: v, bonds: Math.max(0, 1 - v - alloc.cash), cash: alloc.cash })} />
            </td>
          </tr>
          <tr>
            <td>Bonds</td>
            <td style={{ textAlign: "right" }}>
              <PercentInput value={alloc.bonds} step={5}
                onChange={(v) => onChange({ stocks: Math.max(0, 1 - v - alloc.cash), bonds: v, cash: alloc.cash })} />
            </td>
          </tr>
          <tr>
            <td>Cash</td>
            <td style={{ textAlign: "right" }}>
              <PercentInput value={alloc.cash} step={1}
                onChange={(v) => onChange({ stocks: Math.max(0, 1 - v - alloc.bonds), bonds: alloc.bonds, cash: v })} />
            </td>
          </tr>
          <tr style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ fontWeight: 600 }}>Total</td>
            <td style={{ textAlign: "right", fontWeight: 600,
              color: Math.abs(total - 1) < 1e-6 ? "var(--muted)" : "#f0883e" }}>
              {fmtPct(total, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface SnapDraft {
  balances: Record<string, number>;
  spending: Record<string, number>;
  liabilities: Record<string, number>;
}

export default function Accounts() {
  const { scenario, result, axisMode, snapshots, categories,
          addSnapshot, deleteSnapshot } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  const [snapDraft, setSnapDraft] = useState<SnapDraft | null>(null);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const startAge = s.sim.start_year - s.profile.birth_year;
  const retMarker = axisMode === "age" ? s.retirement_age : s.profile.birth_year + s.retirement_age;

  const pools = poolBalances(s.accounts);
  const assets = Object.values(pools).reduce((a, b) => a + b, 0);
  const debt = (s.liabilities ?? []).reduce((a, l) => a + l.balance, 0);
  const total = assets - debt;

  // Growth-section headline metrics (median path, real $)
  const endingRealMedian = result ? result.fan.real.p50[result.fan.real.p50.length - 1] : 0;
  const growthMultiple = result && assets > 0 ? endingRealMedian / assets : 0;
  const medianMaxDD = result ? median(result.max_drawdown) : 0;

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

  // Roth conversion ladder strategy mapping (the engine's conversion_rule)
  const cr = s.conversion_rule;
  const convStrategy =
    cr.kind === "none" ? "none"
    : cr.kind === "fixed" ? "fixed"
    : cr.kind === "fill_bracket" && cr.bracket_top === "custom" ? "custom"
    : "fill_bracket";
  const setConvStrategy = (v: string) => {
    if (v === "none") up({ conversion_rule: { ...cr, kind: "none" } });
    else if (v === "fixed") up({ conversion_rule: { ...cr, kind: "fixed" } });
    else if (v === "custom") up({ conversion_rule: { ...cr, kind: "fill_bracket", bracket_top: "custom" } });
    else up({ conversion_rule: { ...cr, kind: "fill_bracket", bracket_top: cr.bracket_top === "custom" ? "12" : cr.bracket_top } });
  };

  return (
    <div className="stack">
      <SectionNav items={[
        { id: "acc-overview", label: "Overview" },
        { id: "acc-strategy", label: "Strategy" },
        { id: "acc-growth", label: "Growth" },
        { id: "acc-liquidity", label: "Liquidity & Conversions" },
        { id: "acc-history", label: "History" },
      ]} />

      {/* ───────────── OVERVIEW ───────────── */}
      <Head id="acc-overview">Overview</Head>
      <div className="group-grid stretch acc-overview">
        <Section title="Net Worth" className="span1">
          <Stat label={debt > 0 ? "Assets Minus Liabilities" : "Total Across All Pools"}
            value={fmtMoney(total)} />
          <div className="acc-scroll">
          <table className="table">
            <tbody>
              {POOLS.map((p) => (
                <tr key={p}>
                  <td>{POOL_LABELS[p]}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(pools[p])}</td>
                  <td style={{ textAlign: "right", color: "#8b949e" }}>
                    {assets > 0 ? fmtPct(pools[p] / assets, 0) : "—"}
                  </td>
                </tr>
              ))}
              {(s.liabilities ?? []).filter((l) => l.balance > 0).map((l) => (
                <tr key={l.name}>
                  <td style={{ color: "#ff7b72" }}>{l.name}</td>
                  <td style={{ textAlign: "right", color: "#ff7b72" }}>−{fmtMoney(l.balance)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>

        <Section title="Accounts" className="span2"
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
          <div className="acc-scroll">
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
          </div>
        </Section>
      </div>

      <Section title="Debt & Liabilities" info={A.liabilities}
        actions={
          <button className="ghost" onClick={() =>
            up({ liabilities: [...(s.liabilities ?? []), {
              name: "New Loan", balance: 0, interest_rate: 0.05, annual_payment: 0,
            }] })}>+ Add Loan</button>
        }>
        {(s.liabilities ?? []).length > 0 ? (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
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
          </div>
        ) : (
          <p className="hint">Mortgage, car loan, business loans. Payments count as essential non-inflating expenses; the outstanding balance reduces net worth.</p>
        )}
      </Section>

      {/* ───────────── STRATEGY ───────────── */}
      <Head id="acc-strategy">Strategy</Head>
      <div className="group-grid strategy-grid">
        <Section title="Contribution Waterfall" info={A.waterfall}
          actions={
            <button className="ghost" onClick={() =>
              up({ waterfall: [...s.waterfall, { account: "taxable", kind: "max" }] })}>+ Step</button>
          }>
          <div className="strategy-scroll">
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
          </div>
        </Section>

        <Section title="Withdrawal Policy" info={A.policy} className="strategy-policy">
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
            <div className="policy-settings">
              <div className="policy-col-head">Reserves</div>
              <div className="fields">
                <Field label="Cash Buffer"
                  info="The withdrawal policy never draws the cash pool below this amount — your untouchable reserve.">
                  <NumberInput value={s.withdrawal_policy.cash_buffer} step={1000}
                    onChange={(v) => up({ withdrawal_policy: { ...s.withdrawal_policy, cash_buffer: v } })} />
                </Field>
                <Field label="Last Resort"
                  info="Last resort = tapping traditional early and paying the 10% penalty. If every other source is empty before 59½, draw traditional early rather than miss a year. Note: relying on this now counts as a FAILURE — it only changes how a failed path keeps going, not the success rate.">
                  <input type="checkbox" checked={s.withdrawal_policy.allow_early_trad_with_penalty}
                    onChange={(e) => up({ withdrawal_policy: { ...s.withdrawal_policy, allow_early_trad_with_penalty: e.target.checked } })} />
                </Field>
              </div>
              <div className="policy-col-head">HSA<InfoTip text={A.hsa} /></div>
              <div className="fields">
                <Field label="Cash Buffer" info={A.hsaBuffer}>
                  <NumberInput value={s.hsa.cash_buffer} step={500}
                    onChange={(v) => up({ hsa: { ...s.hsa, cash_buffer: v } })} />
                </Field>
                <Field label="Utilization"
                  info={"The share of HSA-eligible medical spending paid tax-free from the HSA each year; the rest is paid out of pocket."}>
                  <PercentInput value={s.hsa.utilization} step={5}
                    onChange={(v) => up({ hsa: { ...s.hsa, utilization: v } })} />
                </Field>
                <Field label="Coverage">
                  <select value={s.hsa.coverage}
                    onChange={(e) => up({ hsa: { ...s.hsa, coverage: e.target.value as any } })}>
                    <option value="self_only">Self-Only</option>
                    <option value="family">Family</option>
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* ───────────── GROWTH ───────────── */}
      <Head id="acc-growth">Growth</Head>
      <HeroRow>
        <HeroStat label="Median Ending Net Worth" value={result ? fmtMoney(endingRealMedian) : "—"}
          sub={`real, at age ${s.profile.horizon_age}`} />
        <HeroStat tone="green" label="Real Growth Multiple"
          value={growthMultiple > 0 ? `${growthMultiple.toFixed(1)}×` : "—"}
          sub={`median ending ÷ ${fmtMoney(assets)} invested today`}
          info="How many times your current invested balance the median path ends with, in today's dollars — the real (inflation-adjusted) growth multiple." />
        <HeroStat tone="amber" label="Median Max Drawdown" value={result ? fmtMoney(medianMaxDD * total) : "—"}
          sub={result ? `${fmtPct(medianMaxDD, 0)} of today's ${fmtMoney(total)}` : "deepest real peak-to-trough fall"}
          info="The deepest real peak-to-trough fall on the median path, shown in today's dollars against your current net worth — how much wealth you'd watch evaporate at the bottom." />
      </HeroRow>
      <Collapsible title="Allocation & Glidepath"
        info="Portfolio weights applied across all accounts. The base mix holds until the first glide phase; each phase re-sets the mix from its age onward — e.g. de-risk approaching retirement, or a rising-equity glide through it."
        defaultOpen
        actions={
          <button className="ghost" onClick={() =>
            up({ allocation_schedule: [...(s.allocation_schedule ?? []),
              { start_age: Math.min(s.retirement_age, s.profile.horizon_age), allocation: { ...s.allocation } }] })}>
            + Add Phase
          </button>
        }>
        <div className="glide-tables">
          <AllocTable alloc={s.allocation}
            className={(s.allocation_schedule ?? []).length > 0 ? "glide-base" : ""}
            onChange={(a) => up({ allocation: a })}
            head={<span className="glide-tag">Base Mix</span>} />
          {(s.allocation_schedule ?? []).map((seg, i) => (
            <AllocTable key={i} alloc={seg.allocation}
              onChange={(a) => up({ allocation_schedule: (s.allocation_schedule ?? []).map((x, j) => j === i ? { ...x, allocation: a } : x) })}
              head={
                <span className="pair">
                  <span className="glide-tag">From Age</span>
                  <NumberInput value={seg.start_age} step={1} min={startAge} max={s.profile.horizon_age}
                    onChange={(v) => up({ allocation_schedule: (s.allocation_schedule ?? []).map((x, j) => j === i ? { ...x, start_age: v } : x) })} />
                  <button className="ghost" title="Remove Phase" onClick={() =>
                    up({ allocation_schedule: (s.allocation_schedule ?? []).filter((_, j) => j !== i) })}>✕</button>
                </span>
              } />
          ))}
        </div>
      </Collapsible>

      <Section className="full" title="Account Balances By Pool"
        info="Median balance of each tax pool over the plan, in today's dollars — the growth and composition story. (The contribution and withdrawal flows now live on the Cash Flow tab.)">
        {result ? <WealthFlowsChart result={result} axisMode={axisMode} />
          : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Maximum Drawdown (Real)" info={A.drawdown}>
        {result ? (
          <>
            <Stat label="Median Maximum Drawdown" value={fmtPct(median(result.max_drawdown))}
              sub="the deepest real peak-to-trough fall you'd have to sit through — be ready for it" info={A.drawdown} />
            <div style={{ display: "grid", gridTemplateColumns: "2fr minmax(240px, 1fr)", gap: 16, alignItems: "start" }}>
              <HistogramChart values={result.max_drawdown} unit="percent" color="rgba(210,153,34,0.55)"
                title="" xTitle="Deepest Peak-To-Trough Fall In Real Net Worth" />
              <table className="table">
                <thead>
                  <tr><th>Scenario</th><th style={{ textAlign: "right" }}>Drop</th>
                    <th style={{ textAlign: "right" }}>On Your {fmtMoney(total)}</th></tr>
                </thead>
                <tbody>
                  {([["Typical", 50], ["1-In-4", 75],
                     ["1-In-10", 90], ["1-In-20", 95]] as [string, number][]).map(([label, p]) => {
                    const dd = pctile(result.max_drawdown, p);
                    return (
                      <tr key={label}>
                        <td>{label}</td>
                        <td style={{ textAlign: "right", color: "#d29922" }}>−{fmtPct(dd, 0)}</td>
                        <td style={{ textAlign: "right", color: "#ff7b72" }}>−{fmtMoney(dd * total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      {/* ───────────── LIQUIDITY & CONVERSIONS ───────────── */}
      <Head id="acc-liquidity">Liquidity &amp; Conversions</Head>
      <Section title="Liquidity: Penalty-Free Assets By Source"
        info={A.accessibility + " The balance you could tap penalty-free each year — a stock, not a surplus. The bridge is the gap between Retire and 60. Its confidence, runway and crash test now live on the Freedom tab, under Retirement Bridge."}>
        {result ? (
          <AccessibilityChart result={result} axisMode={axisMode}
            retirementMarker={retMarker} birthYear={s.profile.birth_year} />
        ) : <p className="hint">Simulation pending…</p>}
      </Section>

      <Section title="Roth Conversion Ladder"
        info={A.ladder + " The ladder's first job here is liquidity — it converts locked traditional into penalty-free Roth for the pre-59½ bridge. Conversions are capped by the traditional balance each year; amounts are the median across paths. (Its tax consequences — RMDs, lifetime tax — live on the Taxes tab.)"}
        actions={result && result.rmd_schedule.length > 0 ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            First RMD @ 75: <strong style={{ color: "#d29922" }}>{fmtMoney(result.rmd_schedule[0].amount_real)}</strong>
            <InfoTip text="Your first Required Minimum Distribution at age 75 (median, today's $) — the forced income the ladder is working to shrink before then. Full schedule on the Taxes tab." />
          </span>
        ) : undefined}>
        <div className="fields" style={{ marginBottom: 10 }}>
          <Field label="Strategy">
            <select value={convStrategy} onChange={(e) => setConvStrategy(e.target.value)}>
              <option value="none">None</option>
              <option value="fill_bracket">Fill To Bracket Top</option>
              <option value="custom">Fill To Income Target</option>
              <option value="fixed">Convert Fixed Amount</option>
            </select>
          </Field>
          {convStrategy === "fill_bracket" && (
            <Field label="Bracket Top">
              <select value={cr.bracket_top}
                onChange={(e) => up({ conversion_rule: { ...cr, bracket_top: e.target.value as any } })}>
                <option value="std_deduction">Std Deduction (0%)</option>
                <option value="10">10% Top</option>
                <option value="12">12% Top</option>
                <option value="22">22% Top</option>
              </select>
            </Field>
          )}
          {convStrategy === "custom" && (
            <Field label="Taxable-Income Target"
              info="Fill ordinary income to this taxable-income level each year (today's $), net of RMDs, SS, and traditional spending withdrawals.">
              <NumberInput value={cr.custom_top ?? 0} step={1000}
                onChange={(v) => up({ conversion_rule: { ...cr, custom_top: v } })} />
            </Field>
          )}
          {convStrategy === "fixed" && (
            <Field label="Conversion Amount"
              info="Convert this dollar amount from Traditional to Roth each year (today's $), regardless of your other income — capped only by the available traditional balance. Unlike the targets above, it does not shrink as RMDs or other income grow, so watch the marginal rate column.">
              <NumberInput value={cr.annual_amount ?? 0} step={1000}
                onChange={(v) => up({ conversion_rule: { ...cr, annual_amount: v } })} />
            </Field>
          )}
          <Field label="From / Until Age"
            info="Defaults: start at retirement, stop at 72. Before 59½ each rung becomes penalty-free after 5 years; from 59½ to ~72 it keeps draining traditional at a low bracket to shrink RMDs.">
            <span className="pair agecell">
              <NumberInput value={cr.start_age ?? s.retirement_age} step={1}
                onChange={(v) => up({ conversion_rule: { ...cr, start_age: v } })} />
              –
              <NumberInput value={cr.end_age ?? 72} step={1}
                onChange={(v) => up({ conversion_rule: { ...cr, end_age: v } })} />
            </span>
          </Field>
        </div>
        {result && result.ladder_schedule.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th><th>Age</th><th>Penalty-Free In</th>
                <th>Convert (Today's $)<InfoTip text="Median amount moved from Traditional to Roth that year, today's $. The full amount lands in your Roth — it's still your money, just relocated (and it starts a 5-year seasoning clock). It is NOT reduced by the tax; the tax is a separate cash cost in the next column." /></th>
                <th>Conversion Tax<InfoTip text="The extra income tax this year's conversion triggers (median, today's $) — the only money that actually leaves your net worth to convert. Paid from your taxable/cash accounts, not skimmed off the conversion. Lower once your brokerage is spent down and the conversion sits alone in a low bracket." /></th>
                <th>Accessible Left<InfoTip text="Your penalty-free (reachable) balance at the END of that year, today's $ — the liquid cushion behind the year. Watch it draw down through the bridge; it falls faster the more aggressively you convert (the conversion tax is paid out of it) and recovers as past conversions season into spendable Roth. Red only if it goes negative." /></th>
                <th>Traditional Left<InfoTip text="Median traditional balance after that year's conversion and growth, today's $." /></th>
                <th>Effective Rate<InfoTip text="Average federal + state income-tax rate that year on the median path — the blended cost, beside the marginal next-dollar cost." /></th>
                <th>Next $ Taxed At<InfoTip text="Marginal federal + state rate the next conversion dollar would face on the median path." /></th>
              </tr>
            </thead>
            <tbody>
              {result.ladder_schedule.map((r) => {
                const penaltyFree = r.age >= 60 ? "Immediate"
                  : Math.min(r.matures, s.profile.birth_year + 60);
                return (
                  <tr key={r.year}>
                    <td>{r.year}</td><td>{r.age}</td><td>{penaltyFree}</td>
                    <td>{fmtMoney(r.amount_real)}</td>
                    <td>{fmtMoney(r.conversion_tax_real)}</td>
                    <td style={{ color: r.accessible_left_real < 0 ? "#ff7b72" : undefined }}>
                      {fmtMoney(r.accessible_left_real)}
                    </td>
                    <td>{fmtMoney(r.trad_remaining_real)}</td>
                    <td>{fmtPct(r.effective_rate, 0)}</td>
                    <td>{fmtPct(r.marginal_rate, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="hint">No conversions in the median path. Pick a strategy above to build penalty-free income for the bridge years.</p>
        )}
      </Section>

      {result && (
        <Section title="Conversions vs ACA Subsidy" info={A.aca}>
          {result.healthcare?.subsidy_real?.some((v) => v > 1) ? (
            <SubsidyConversionChart result={result} axisMode={axisMode}
              retirementAge={s.retirement_age} coverageEndAge={s.aca.coverage_end_age}
              birthYear={s.profile.birth_year} />
          ) : (
            <p className="hint">
              Enable the ACA Premium Subsidy (Cash Flow tab) to see what each conversion dollar
              costs you in lost subsidy — every dollar converted raises MAGI and shrinks the
              pre-65 subsidy.
            </p>
          )}
        </Section>
      )}

      {/* ───────────── HISTORY ───────────── */}
      <Head id="acc-history">History</Head>
      <Section title="Record A Snapshot" info={A.snapshots}>
        {snapDraft ? (
          <>
            <div className="snap-head">Balances</div>
            {POOLS.map((p) => (
              <Field key={p} label={POOL_LABELS[p]}>
                <NumberInput value={snapDraft.balances[p] ?? 0} step={500}
                  onChange={(v) => setSnapDraft({
                    ...snapDraft, balances: { ...snapDraft.balances, [p]: v },
                  })} />
              </Field>
            ))}
            <div className="snap-head">
              Annual Spending
              <InfoTip text="Nominal dollars per year at today's prices, summed from your budget's category totals. Sinking-fund contributions count as spending in their category; income taxes and loan payments are tracked elsewhere." />
            </div>
            {categories.map((c) => (
              <Field key={c.slug} label={c.name}>
                <NumberInput value={snapDraft.spending[c.slug] ?? 0} step={250}
                  onChange={(v) => setSnapDraft({
                    ...snapDraft, spending: { ...snapDraft.spending, [c.slug]: v },
                  })} />
              </Field>
            ))}
            {(s.liabilities ?? []).length > 0 && (
              <>
                <div className="snap-head">Loan Balances</div>
                {(s.liabilities ?? []).map((l) => (
                  <Field key={l.name} label={l.name}>
                    <NumberInput value={snapDraft.liabilities[l.name] ?? 0} step={1000}
                      onChange={(v) => setSnapDraft({
                        ...snapDraft, liabilities: { ...snapDraft.liabilities, [l.name]: v },
                      })} />
                  </Field>
                ))}
              </>
            )}
            <div className="pair" style={{ marginTop: 8 }}>
              <button onClick={async () => {
                await addSnapshot({
                  date: new Date().toISOString().slice(0, 10),
                  ...snapDraft,
                });
                setSnapDraft(null);
              }}>Save</button>
              <button className="ghost" onClick={() => setSnapDraft(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {snapshots.length > 0 ? (
              <table className="table">
                <tbody>
                  {snapshots.map((snap) => {
                    const spendTotal = Object.values(snap.spending ?? {}).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={snap.date}>
                        <td>{snap.date}</td>
                        <td style={{ textAlign: "right" }}>
                          {fmtMoney(Object.values(snap.balances).reduce((a, b) => a + b, 0))}
                        </td>
                        <td style={{ textAlign: "right", color: "#8b949e" }}>
                          {spendTotal > 0 ? `${fmtMoney(spendTotal)}/yr` : ""}
                        </td>
                        <td>
                          <button className="ghost" title="Delete Snapshot"
                            onClick={() => deleteSnapshot(snap.date)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="hint">No snapshots recorded yet.</p>
            )}
            <button onClick={() => {
              const last = snapshots[snapshots.length - 1];
              setSnapDraft({
                balances: pools,
                spending: { ...(last?.spending ?? {}) },
                liabilities: Object.fromEntries(
                  (s.liabilities ?? []).map((l) => [l.name, l.balance])),
              });
            }}>+ Snapshot Today</button>
          </>
        )}
      </Section>

      {snapshots.length >= 2 && (
        <Section title="Net Worth Over Time"
          info="Your recorded snapshots' total balances minus loan balances, over time — the actual trajectory, anchored at the dates you logged. Projections elsewhere always start from today; this is the historical record.">
          <SeriesChart
            x={snapshots.map((sn) => new Date(sn.date).getFullYear())}
            axisMode="year" yFormat="money" title=""
            series={[{
              name: "Recorded Net Worth", color: "#58a6ff", fill: true,
              values: snapshots.map((sn) =>
                Object.values(sn.balances).reduce((a, b) => a + b, 0)
                - Object.values(sn.liabilities ?? {}).reduce((a, b) => a + b, 0)),
            }]} />
        </Section>
      )}
    </div>
  );
}
