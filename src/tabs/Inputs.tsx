import React from "react";
import { A } from "../assumptions";
import { useStore } from "../store";
import type {
  Account, AccountType, ExpenseStream, Scenario, WaterfallStep, WithdrawalSource,
} from "../types";
import { Field, NumberInput, PercentInput, Section } from "../components/ui";

const ACCOUNT_LABELS: Record<AccountType, string> = {
  taxable: "Brokerage (taxable)",
  trad_401k: "Traditional 401(k)",
  trad_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  roth_401k: "Roth 401(k)",
  hsa: "HSA",
  cash: "Cash",
};

const SOURCE_LABELS: Record<WithdrawalSource, string> = {
  cash: "Cash",
  taxable: "Taxable",
  roth_basis: "Roth contributions",
  roth_matured_conversions: "Matured conversions",
  trad: "Traditional",
  hsa: "HSA (65+)",
  roth_earnings: "Roth earnings",
};

export default function Inputs() {
  const scenario = useStore((s) => s.scenario);
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const upAccount = (i: number, patch: Partial<Account>) => {
    const accounts = s.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a));
    up({ accounts });
  };
  const upStream = (i: number, patch: Partial<ExpenseStream>) => {
    const expense_streams = s.expense_streams.map((e, j) => (j === i ? { ...e, ...patch } : e));
    up({ expense_streams });
  };

  return (
    <div className="grid2">
      <Section title="Profile" info={A.realDollars}>
        <div className="fields">
          <Field label="Birth year">
            <NumberInput value={s.profile.birth_year} step={1}
              onChange={(v) => up({ profile: { ...s.profile, birth_year: v } })} />
          </Field>
          <Field label="Plan to age" info="Fixed planning horizon — no mortality table.">
            <NumberInput value={s.profile.horizon_age} step={1} min={50} max={105}
              onChange={(v) => up({ profile: { ...s.profile, horizon_age: v } })} />
          </Field>
          <Field label="Retirement age">
            <NumberInput value={s.retirement_age} step={1}
              onChange={(v) => up({ retirement_age: v })} />
          </Field>
          <Field label="State tax (flat)" info={A.taxes}>
            <PercentInput value={s.profile.state_tax_rate}
              onChange={(v) => up({ profile: { ...s.profile, state_tax_rate: v } })} />
          </Field>
        </div>
      </Section>

      <Section title="Income" info="Salary grows in real terms; it stops at retirement unless a later regime event sets a new one.">
        <div className="fields">
          <Field label="Gross salary">
            <NumberInput value={s.income.gross_salary} step={1000}
              onChange={(v) => up({ income: { ...s.income, gross_salary: v } })} />
          </Field>
          <Field label="Real growth /yr">
            <PercentInput value={s.income.real_growth} step={0.25}
              onChange={(v) => up({ income: { ...s.income, real_growth: v } })} />
          </Field>
          <Field label="Employer match (% of salary)">
            <PercentInput value={s.income.employer_match_pct} step={0.5}
              onChange={(v) => up({ income: { ...s.income, employer_match_pct: v } })} />
          </Field>
        </div>
      </Section>

      <Section
        title="Accounts"
        info="Balances merge into five tax pools: taxable, traditional, Roth, HSA, cash."
        actions={
          <select
            className="add-select"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              up({ accounts: [...s.accounts, { type: e.target.value as AccountType, balance: 0 }] });
            }}>
            <option value="">+ add account</option>
            {Object.entries(ACCOUNT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        }>
        <table className="table">
          <thead>
            <tr><th>Account</th><th>Balance</th><th>Cost basis / Roth basis</th><th /></tr>
          </thead>
          <tbody>
            {s.accounts.map((a, i) => (
              <tr key={i}>
                <td>{ACCOUNT_LABELS[a.type]}</td>
                <td><NumberInput value={a.balance} step={1000}
                  onChange={(v) => upAccount(i, { balance: v })} /></td>
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
        title="Expenses"
        info="Streams in today's dollars. Non-inflating streams (a mortgage) stay fixed in nominal dollars. Medical streams are HSA-eligible."
        actions={
          <button className="ghost" onClick={() =>
            up({ expense_streams: [...s.expense_streams, {
              name: "New stream", annual: 0, inflates: true, extra_inflation: 0,
              is_medical: false, essential: false,
            }] })}>+ add stream</button>
        }>
        <table className="table">
          <thead>
            <tr><th>Name</th><th>$/yr</th><th>Ages</th><th>CPI+</th><th>Inflates</th><th>Medical</th><th>Essential</th><th /></tr>
          </thead>
          <tbody>
            {s.expense_streams.map((e, i) => (
              <tr key={i}>
                <td><input value={e.name} onChange={(ev) => upStream(i, { name: ev.target.value })} /></td>
                <td><NumberInput value={e.annual} step={500} onChange={(v) => upStream(i, { annual: v })} /></td>
                <td className="agecell">
                  <NumberInput value={e.start_age ?? s.sim.start_year - s.profile.birth_year} step={1}
                    onChange={(v) => upStream(i, { start_age: v })} />
                  –
                  <NumberInput value={e.end_age ?? s.profile.horizon_age} step={1}
                    onChange={(v) => upStream(i, { end_age: v })} />
                </td>
                <td><PercentInput value={e.extra_inflation} step={0.25}
                  onChange={(v) => upStream(i, { extra_inflation: v })} /></td>
                <td><input type="checkbox" checked={e.inflates}
                  onChange={(ev) => upStream(i, { inflates: ev.target.checked })} /></td>
                <td><input type="checkbox" checked={e.is_medical}
                  onChange={(ev) => upStream(i, { is_medical: ev.target.checked })} /></td>
                <td><input type="checkbox" checked={e.essential}
                  onChange={(ev) => upStream(i, { essential: ev.target.checked })} /></td>
                <td><button className="ghost" onClick={() =>
                  up({ expense_streams: s.expense_streams.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Market model" info={A.cagr}>
        <div className="fields">
          <Field label="Mode" info={A.bootstrap}>
            <select value={s.market.mode}
              onChange={(e) => up({ market: { ...s.market, mode: e.target.value as any } })}>
              <option value="bootstrap">Historical bootstrap</option>
              <option value="parametric">Parametric (lognormal)</option>
            </select>
          </Field>
          <Field label="Stocks real CAGR / vol">
            <span className="pair">
              <PercentInput value={s.market.stocks.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, real_cagr: v } } })} />
              <PercentInput value={s.market.stocks.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, vol: v } } })} />
            </span>
          </Field>
          <Field label="Bonds real CAGR / vol">
            <span className="pair">
              <PercentInput value={s.market.bonds.real_cagr} step={0.25}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, real_cagr: v } } })} />
              <PercentInput value={s.market.bonds.vol} step={1}
                onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, vol: v } } })} />
            </span>
          </Field>
          <Field label="Allocation (stocks/bonds/cash)">
            <span className="pair">
              <PercentInput value={s.allocation.stocks} step={5}
                onChange={(v) => up({ allocation: { ...s.allocation, stocks: v, bonds: Math.max(0, 1 - v - s.allocation.cash) } })} />
              <PercentInput value={s.allocation.bonds} step={5}
                onChange={(v) => up({ allocation: { ...s.allocation, bonds: v, stocks: Math.max(0, 1 - v - s.allocation.cash) } })} />
              <PercentInput value={s.allocation.cash} step={1}
                onChange={(v) => up({ allocation: { ...s.allocation, cash: v, stocks: Math.max(0, 1 - v - s.allocation.bonds) } })} />
            </span>
          </Field>
          <Field label="Mean-shift history to my CAGRs" info="De-means historical bootstrap returns toward your entered CAGRs.">
            <input type="checkbox" checked={s.market.bootstrap_mean_shift}
              onChange={(e) => up({ market: { ...s.market, bootstrap_mean_shift: e.target.checked } })} />
          </Field>
        </div>
      </Section>

      <Section title="Inflation" info={A.inflation}>
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
      </Section>

      <Section
        title="Contribution waterfall"
        info={A.waterfall}
        actions={
          <button className="ghost" onClick={() =>
            up({ waterfall: [...s.waterfall, { account: "taxable", kind: "max" }] })}>+ step</button>
        }>
        <table className="table">
          <thead><tr><th>#</th><th>Account</th><th>Amount</th><th /><th /></tr></thead>
          <tbody>
            {s.waterfall.map((w, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <select value={w.account} onChange={(e) => {
                    const waterfall = s.waterfall.map((x, j) =>
                      j === i ? { ...x, account: e.target.value as AccountType } : x);
                    up({ waterfall });
                  }}>
                    {Object.entries(ACCOUNT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={w.kind} onChange={(e) => {
                    const waterfall = s.waterfall.map((x, j) =>
                      j === i ? { ...x, kind: e.target.value as WaterfallStep["kind"] } : x);
                    up({ waterfall });
                  }}>
                    <option value="to_match">to employer match</option>
                    <option value="max">max (IRS limit)</option>
                    <option value="fixed">fixed $</option>
                  </select>
                  {w.kind === "fixed" && (
                    <NumberInput value={w.amount ?? 0} step={500} onChange={(v) => {
                      const waterfall = s.waterfall.map((x, j) => (j === i ? { ...x, amount: v } : x));
                      up({ waterfall });
                    }} />
                  )}
                </td>
                <td>
                  <button className="ghost" disabled={i === 0} onClick={() => {
                    const waterfall = [...s.waterfall];
                    [waterfall[i - 1], waterfall[i]] = [waterfall[i], waterfall[i - 1]];
                    up({ waterfall });
                  }}>↑</button>
                </td>
                <td><button className="ghost" onClick={() =>
                  up({ waterfall: s.waterfall.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Withdrawal policy" info={A.policy}>
        <ol className="policy-list">
          {s.withdrawal_policy.order.map((src, i) => (
            <li key={src}>
              {SOURCE_LABELS[src]}
              <span>
                <button className="ghost" disabled={i === 0} onClick={() => {
                  const order = [...s.withdrawal_policy.order];
                  [order[i - 1], order[i]] = [order[i], order[i - 1]];
                  up({ withdrawal_policy: { ...s.withdrawal_policy, order } });
                }}>↑</button>
                <button className="ghost" disabled={i === s.withdrawal_policy.order.length - 1}
                  onClick={() => {
                    const order = [...s.withdrawal_policy.order];
                    [order[i + 1], order[i]] = [order[i], order[i + 1]];
                    up({ withdrawal_policy: { ...s.withdrawal_policy, order } });
                  }}>↓</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="fields">
          <Field label="Cash buffer (keep untouched)">
            <NumberInput value={s.withdrawal_policy.cash_buffer} step={1000}
              onChange={(v) => up({ withdrawal_policy: { ...s.withdrawal_policy, cash_buffer: v } })} />
          </Field>
          <Field label="Last resort: early traditional w/ 10% penalty">
            <input type="checkbox" checked={s.withdrawal_policy.allow_early_trad_with_penalty}
              onChange={(e) => up({ withdrawal_policy: { ...s.withdrawal_policy, allow_early_trad_with_penalty: e.target.checked } })} />
          </Field>
        </div>
      </Section>

      <Section title="Spending guardrails" info={A.guardrails}>
        <div className="fields">
          <Field label="Enabled">
            <input type="checkbox" checked={s.guardrails.enabled}
              onChange={(e) => up({ guardrails: { ...s.guardrails, enabled: e.target.checked } })} />
          </Field>
          <Field label="Guard band (± around initial rate)">
            <PercentInput value={s.guardrails.band} step={5}
              onChange={(v) => up({ guardrails: { ...s.guardrails, band: v } })} />
          </Field>
          <Field label="Cut step">
            <PercentInput value={s.guardrails.cut} step={2.5}
              onChange={(v) => up({ guardrails: { ...s.guardrails, cut: v } })} />
          </Field>
          <Field label="Restore step">
            <PercentInput value={s.guardrails.boost} step={2.5}
              onChange={(v) => up({ guardrails: { ...s.guardrails, boost: v } })} />
          </Field>
          <Field label="Floor (min % of planned discretionary)">
            <PercentInput value={s.guardrails.floor_mult} step={5}
              onChange={(v) => up({ guardrails: { ...s.guardrails, floor_mult: v } })} />
          </Field>
        </div>
        <p className="hint">
          Cuts apply only to streams not marked Essential in the Expenses table.
        </p>
      </Section>

      <Section title="Roth conversion ladder" info={A.ladder}>
        <div className="fields">
          <Field label="Strategy">
            <select value={s.conversion_rule.kind}
              onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, kind: e.target.value as any } })}>
              <option value="none">None</option>
              <option value="fill_bracket">Fill to bracket top</option>
              <option value="fixed">Fixed $/yr</option>
            </select>
          </Field>
          {s.conversion_rule.kind === "fill_bracket" && (
            <Field label="Bracket top">
              <select value={s.conversion_rule.bracket_top}
                onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, bracket_top: e.target.value as any } })}>
                <option value="std_deduction">Standard deduction (0% tax)</option>
                <option value="10">Top of 10%</option>
                <option value="12">Top of 12%</option>
                <option value="22">Top of 22%</option>
              </select>
            </Field>
          )}
          {s.conversion_rule.kind === "fixed" && (
            <Field label="Annual amount">
              <NumberInput value={s.conversion_rule.annual_amount} step={1000}
                onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, annual_amount: v } })} />
            </Field>
          )}
          <Field label="Ages (blank = retirement → 58)">
            <span className="pair">
              <NumberInput value={s.conversion_rule.start_age ?? s.retirement_age} step={1}
                onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, start_age: v } })} />
              <NumberInput value={s.conversion_rule.end_age ?? 58} step={1}
                onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, end_age: v } })} />
            </span>
          </Field>
        </div>
      </Section>

      <Section title="Social Security" info={A.ss}>
        <div className="fields">
          <Field label="Monthly benefit at FRA (today's $)">
            <NumberInput value={s.social_security.monthly_at_fra} step={100}
              onChange={(v) => up({ social_security: { ...s.social_security, monthly_at_fra: v } })} />
          </Field>
          <Field label="Claiming age (62–70)">
            <NumberInput value={s.social_security.claiming_age} step={1} min={62} max={70}
              onChange={(v) => up({ social_security: { ...s.social_security, claiming_age: v } })} />
          </Field>
          <Field label="Haircut (trust-fund scenario)">
            <select value={String(s.social_security.haircut)}
              onChange={(e) => up({ social_security: { ...s.social_security, haircut: parseFloat(e.target.value) } })}>
              <option value="1">100% of projected</option>
              <option value="0.75">75%</option>
              <option value="0.5">50%</option>
              <option value="0.25">25%</option>
              <option value="0">0% (none)</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="HSA" info={A.hsa}>
        <div className="fields">
          <Field label="Utilization (share of medical paid from HSA)">
            <PercentInput value={s.hsa.utilization} step={5}
              onChange={(v) => up({ hsa: { ...s.hsa, utilization: v } })} />
          </Field>
          <Field label="Coverage">
            <select value={s.hsa.coverage}
              onChange={(e) => up({ hsa: { ...s.hsa, coverage: e.target.value as any } })}>
              <option value="self_only">Self-only</option>
              <option value="family">Family</option>
            </select>
          </Field>
        </div>
      </Section>
    </div>
  );
}
