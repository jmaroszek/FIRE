import React from "react";
import { A } from "../assumptions";
import { InfoTip } from "../components/ui";
import { useStore } from "../store";
import type {
  Account, AccountType, ExpenseStream, Scenario, WaterfallStep, WithdrawalSource,
} from "../types";
import { Field, NumberInput, PercentInput, Section } from "../components/ui";

const ACCOUNT_LABELS: Record<AccountType, string> = {
  taxable: "Brokerage",
  trad_401k: "Traditional 401k",
  trad_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  roth_401k: "Roth 401k",
  hsa: "HSA",
  cash: "Cash",
};

const SOURCE_LABELS: Record<WithdrawalSource, string> = {
  cash: "Cash",
  taxable: "Brokerage",
  roth_basis: "Roth Contributions",
  roth_matured_conversions: "Matured Conversions",
  trad: "Traditional",
  hsa: "HSA (65+)",
  roth_earnings: "Roth Earnings",
};

function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="input-group">
      <h2 className="group-title">{props.title}</h2>
      <div className="group-grid">{props.children}</div>
    </div>
  );
}

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
  const moveWaterfall = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.waterfall.length) return;
    const waterfall = [...s.waterfall];
    [waterfall[i], waterfall[j]] = [waterfall[j], waterfall[i]];
    up({ waterfall });
  };

  return (
    <div className="stack">
      <Group title="Profile & Income">
        <Section title="Profile" info={A.realDollars}>
          <div className="fields">
            <Field label="Birth Year">
              <NumberInput value={s.profile.birth_year} step={1}
                onChange={(v) => up({ profile: { ...s.profile, birth_year: v } })} />
            </Field>
            <Field label="Plan To Age" info="Fixed planning horizon — no mortality table.">
              <NumberInput value={s.profile.horizon_age} step={1} min={50} max={105}
                onChange={(v) => up({ profile: { ...s.profile, horizon_age: v } })} />
            </Field>
            <Field label="Retirement Age">
              <NumberInput value={s.retirement_age} step={1}
                onChange={(v) => up({ retirement_age: v })} />
            </Field>
            <Field label="State Tax (Flat)" info={A.taxes}>
              <PercentInput value={s.profile.state_tax_rate}
                onChange={(v) => up({ profile: { ...s.profile, state_tax_rate: v } })} />
            </Field>
          </div>
        </Section>

        <Section title="Income" info="Salary in today's dollars. It stops at retirement unless a later New Salary event sets another one.">
          <div className="fields">
            <Field label="Gross Salary">
              <NumberInput value={s.income.gross_salary} step={1000}
                onChange={(v) => up({ income: { ...s.income, gross_salary: v } })} />
            </Field>
            <Field label="Annual Raise" info={A.growthMode}>
              <span className="pair">
                <PercentInput value={s.income.real_growth} step={0.25}
                  onChange={(v) => up({ income: { ...s.income, real_growth: v } })} />
                <select value={s.income.growth_mode}
                  onChange={(e) => up({ income: { ...s.income, growth_mode: e.target.value as any } })}>
                  <option value="nominal">Nominal</option>
                  <option value="real">Real (Above Inflation)</option>
                </select>
              </span>
            </Field>
            <Field label="Employer Match (% Of Salary)">
              <PercentInput value={s.income.employer_match_pct} step={0.5}
                onChange={(v) => up({ income: { ...s.income, employer_match_pct: v } })} />
            </Field>
          </div>
        </Section>
      </Group>

      <Group title="Accounts">
        <Section
          title="Balances"
          info="Balances merge into five tax pools: brokerage, traditional, Roth, HSA, cash."
          actions={
            <select
              className="add-select"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                up({ accounts: [...s.accounts, { type: e.target.value as AccountType, balance: 0 }] });
              }}>
              <option value="">+ Add Account</option>
              {Object.entries(ACCOUNT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          }>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Balance</th>
                <th>
                  Cost / Contribution Basis
                  <InfoTip text={`Brokerage: ${A.costBasis} — Roth: ${A.rothBasis}`} />
                </th>
                <th />
              </tr>
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

        <Section title="HSA Settings" info={A.hsa}>
          <div className="fields">
            <Field label="Utilization"
              info={"The share of HSA-eligible expenses paid from the HSA each year (tax-free); the rest is paid out of pocket. " + A.hsaEligible}>
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
        </Section>
      </Group>

      <Group title="Spending">
        <Section
          wide
          title="Expenses"
          info="Streams in today's dollars. Mortgages and car loans belong here too: give them an end age and uncheck Inflates (fixed payments don't rise with CPI)."
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
              </tr>
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

        <Section title="Spending Guardrails" info={A.guardrails}>
          <div className="fields">
            <Field label="Enabled">
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
          </div>
          <p className="hint">
            Cuts apply only to streams not marked Essential in the Expenses table.
          </p>
        </Section>
      </Group>

      <Group title="Market & Inflation">
        <Section title="Market Model" info={A.cagr}>
          <div className="fields">
            <Field label="Mode" info={A.bootstrap}>
              <select value={s.market.mode}
                onChange={(e) => up({ market: { ...s.market, mode: e.target.value as any } })}>
                <option value="bootstrap">Historical Bootstrap</option>
                <option value="parametric">Parametric (Lognormal)</option>
              </select>
            </Field>
            <Field label="Stocks: Real CAGR / Volatility" info={A.vol}>
              <span className="pair">
                <PercentInput value={s.market.stocks.real_cagr} step={0.25}
                  onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, real_cagr: v } } })} />
                <PercentInput value={s.market.stocks.vol} step={1}
                  onChange={(v) => up({ market: { ...s.market, stocks: { ...s.market.stocks, vol: v } } })} />
              </span>
            </Field>
            <Field label="Bonds: Real CAGR / Volatility" info={A.vol}>
              <span className="pair">
                <PercentInput value={s.market.bonds.real_cagr} step={0.25}
                  onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, real_cagr: v } } })} />
                <PercentInput value={s.market.bonds.vol} step={1}
                  onChange={(v) => up({ market: { ...s.market, bonds: { ...s.market.bonds, vol: v } } })} />
              </span>
            </Field>
            <Field label="Allocation: Stocks / Bonds / Cash">
              <span className="pair">
                <PercentInput value={s.allocation.stocks} step={5}
                  onChange={(v) => up({ allocation: { ...s.allocation, stocks: v, bonds: Math.max(0, 1 - v - s.allocation.cash) } })} />
                <PercentInput value={s.allocation.bonds} step={5}
                  onChange={(v) => up({ allocation: { ...s.allocation, bonds: v, stocks: Math.max(0, 1 - v - s.allocation.cash) } })} />
                <PercentInput value={s.allocation.cash} step={1}
                  onChange={(v) => up({ allocation: { ...s.allocation, cash: v, stocks: Math.max(0, 1 - v - s.allocation.bonds) } })} />
              </span>
            </Field>
            <Field label="Mean-Shift History To My CAGRs"
              info="Bootstrap mode only: shifts historical returns so their long-run average matches your entered CAGRs, keeping history's volatility and correlations. Use if you believe future returns will be lower than the past.">
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
          <p className="hint">Bootstrap mode samples inflation jointly with returns from history; these AR(1) settings apply to parametric mode (and to nominal-raise conversion via the mean).</p>
        </Section>
      </Group>

      <Group title="Strategy">
        <Section
          title="Contribution Waterfall"
          info={A.waterfall}
          actions={
            <button className="ghost" onClick={() =>
              up({ waterfall: [...s.waterfall, { account: "taxable", kind: "max" }] })}>+ Step</button>
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
                    <span className="pair">
                      <select value={w.kind} onChange={(e) => {
                        const waterfall = s.waterfall.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value as WaterfallStep["kind"] } : x);
                        up({ waterfall });
                      }}>
                        <option value="to_match">To Employer Match</option>
                        <option value="max">Max (IRS Limit)</option>
                        <option value="fixed">Fixed $</option>
                      </select>
                      {w.kind === "fixed" && (
                        <NumberInput value={w.amount ?? 0} step={500} onChange={(v) => {
                          const waterfall = s.waterfall.map((x, j) => (j === i ? { ...x, amount: v } : x));
                          up({ waterfall });
                        }} />
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="pair">
                      <button className="ghost" disabled={i === 0}
                        onClick={() => moveWaterfall(i, -1)}>↑</button>
                      <button className="ghost" disabled={i === s.waterfall.length - 1}
                        onClick={() => moveWaterfall(i, 1)}>↓</button>
                    </span>
                  </td>
                  <td><button className="ghost" onClick={() =>
                    up({ waterfall: s.waterfall.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Withdrawal Policy" info={A.policy}>
          <div className="policy-row">
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
              <Field label="Cash Buffer"
                info="The withdrawal policy never draws the cash pool below this amount (today's dollars) — it's your untouchable emergency reserve.">
                <NumberInput value={s.withdrawal_policy.cash_buffer} step={1000}
                  onChange={(v) => up({ withdrawal_policy: { ...s.withdrawal_policy, cash_buffer: v } })} />
              </Field>
              <Field label="Last Resort: Early Traditional W/ 10% Penalty"
                info="If every other source is empty before 59½, tap traditional accounts and pay the 10% penalty rather than fail. Withdrawals that needed this are still counted, penalty and all.">
                <input type="checkbox" checked={s.withdrawal_policy.allow_early_trad_with_penalty}
                  onChange={(e) => up({ withdrawal_policy: { ...s.withdrawal_policy, allow_early_trad_with_penalty: e.target.checked } })} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Roth Conversion Ladder" info={A.ladder}>
          <div className="fields">
            <Field label="Strategy">
              <select value={s.conversion_rule.kind}
                onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, kind: e.target.value as any } })}>
                <option value="none">None</option>
                <option value="fill_bracket">Fill To Bracket Top</option>
                <option value="fixed">Fixed $ / Yr</option>
              </select>
            </Field>
            {s.conversion_rule.kind === "fill_bracket" && (
              <Field label="Bracket Top">
                <select value={s.conversion_rule.bracket_top}
                  onChange={(e) => up({ conversion_rule: { ...s.conversion_rule, bracket_top: e.target.value as any } })}>
                  <option value="std_deduction">Standard Deduction (0% Tax)</option>
                  <option value="10">Top Of 10%</option>
                  <option value="12">Top Of 12%</option>
                  <option value="22">Top Of 22%</option>
                </select>
              </Field>
            )}
            {s.conversion_rule.kind === "fixed" && (
              <Field label="Annual Amount">
                <NumberInput value={s.conversion_rule.annual_amount} step={1000}
                  onChange={(v) => up({ conversion_rule: { ...s.conversion_rule, annual_amount: v } })} />
              </Field>
            )}
            <Field label="Convert From Age / Until Age"
              info="Defaults: start at retirement; stop at 58, the last rung that matters — a conversion at 55 or later only finishes its 5-year seasoning after you're 59½, when traditional money is penalty-free anyway.">
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
        </Section>
      </Group>
    </div>
  );
}
