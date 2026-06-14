import React from "react";
import { A } from "../assumptions";
import { AccountBalanceChart, FanChart, InflationFanChart, InvestingChart } from "../components/charts";
import {
  Field, Group, InfoTip, NumberInput, PercentInput, Section, fmtMoney, fmtPct,
} from "../components/ui";
import { ACCOUNT_LABELS } from "../labels";
import { useStore } from "../store";
import type { Account, AccountType, Scenario, WaterfallStep } from "../types";

export default function Investing() {
  const { scenario, result, simulating, simError, axisMode, display,
          snapshots, rothtrad, runRothTrad, rothtradLoading } = useStore();
  const setScenario = useStore((s) => s.setScenario);
  if (!scenario) return null;
  const s = scenario;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });

  const upAccount = (i: number, patch: Partial<Account>) => {
    const accounts = s.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a));
    up({ accounts });
  };
  const moveWaterfall = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.waterfall.length) return;
    const waterfall = [...s.waterfall];
    [waterfall[i], waterfall[j]] = [waterfall[j], waterfall[i]];
    up({ waterfall });
  };

  const retMarker = axisMode === "age"
    ? s.retirement_age
    : s.profile.birth_year + s.retirement_age;

  return (
    <div className="stack">
      <Group title="Accounts">
        <Section
          className="span1"
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
                  Basis
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

        <Section className="span1" title="HSA Settings" info={A.hsa}>
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

        <Section className="full" title="Account Balances Over Time"
          info="Median balance of each tax pool across the plan, in today's dollars. Watch the mix shift as you accumulate, run Roth conversions, and draw down.">
          {result ? (
            <AccountBalanceChart result={result} axisMode={axisMode} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>
      </Group>

      <Group title="Contributions">
        <Section className="span1" title="Annual Investing" info={A.investing}>
          {result ? (
            <InvestingChart result={result} axisMode={axisMode} />
          ) : (
            <p className="hint">Simulation pending…</p>
          )}
        </Section>

        <Section
          className="span1"
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
                      const account = e.target.value as AccountType;
                      const waterfall = s.waterfall.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              account,
                              // "to match" only exists for the traditional 401k
                              kind: x.kind === "to_match" && account !== "trad_401k"
                                ? ("max" as const) : x.kind,
                            }
                          : x);
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
                        {w.account === "trad_401k" && (
                          <option value="to_match">To Match</option>
                        )}
                        {/* brokerage/cash have no IRS limit: "max" = take all remaining surplus */}
                        <option value="max">
                          {w.account === "taxable" || w.account === "cash" ? "Spillover" : "Max"}
                        </option>
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

        <Section className="span1" title="Roth vs Traditional Contributions" info={A.rothTrad}
          actions={rothtrad && (
            <button className="ghost" onClick={runRothTrad} disabled={rothtradLoading}>
              {rothtradLoading ? "Computing…" : "Recompute"}
            </button>
          )}>
          {rothtrad ? (
            <>
              <table className="table">
                <thead><tr><th /><th>Traditional</th><th>Roth</th></tr></thead>
                <tbody>
                  <tr><td>Success Probability</td>
                    <td>{fmtPct(rothtrad.trad.success_rate)}</td>
                    <td>{fmtPct(rothtrad.roth.success_rate)}</td></tr>
                  <tr><td>Lifetime Tax (Today's $)</td>
                    <td>{fmtMoney(rothtrad.trad.lifetime_tax_real)}</td>
                    <td>{fmtMoney(rothtrad.roth.lifetime_tax_real)}</td></tr>
                  <tr><td>Median Ending Net Worth</td>
                    <td>{fmtMoney(rothtrad.trad.ending_real)}</td>
                    <td>{fmtMoney(rothtrad.roth.ending_real)}</td></tr>
                </tbody>
              </table>
              <p className="hint">
                Routing tax-advantaged contributions to{" "}
                <strong>{rothtrad.ending_diff >= 0 ? "Roth" : "Traditional"}</strong>{" "}
                ends with {fmtMoney(Math.abs(rothtrad.ending_diff))} more net worth (today's $);
                lifetime tax differs by {fmtMoney(Math.abs(rothtrad.tax_diff))}.
              </p>
            </>
          ) : (
            <button onClick={runRothTrad} disabled={rothtradLoading}>
              {rothtradLoading ? "Computing…" : "Compare"}
            </button>
          )}
        </Section>
      </Group>

      <Group title="Markets">
        <Section className="span1" title="Market Model" info={A.cagr}>
          <div className="fields">
            <Field label="Mode" info={A.bootstrap}>
              <select value={s.market.mode}
                onChange={(e) => up({ market: { ...s.market, mode: e.target.value as any } })}>
                <option value="bootstrap">Historical Bootstrap</option>
                <option value="parametric">Parametric (Lognormal)</option>
              </select>
            </Field>
          </div>
          <div className="fields">
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
            <Field label="Allocation" info="Portfolio weights, in order: Stocks / Bonds / Cash. One global allocation across all accounts.">
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
              info="Bootstrap mode only: shifts historical returns so their long-run average matches your entered CAGRs, keeping history's volatility and correlations. Use if you believe future returns will be lower than the past.">
              <input type="checkbox" checked={s.market.bootstrap_mean_shift}
                onChange={(e) => up({ market: { ...s.market, bootstrap_mean_shift: e.target.checked } })} />
            </Field>
          </div>
        </Section>

        <Section className="span1" title="Inflation" info={A.inflation}>
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
          {result && (
            <div style={{ marginTop: 10 }}>
              <InflationFanChart result={result} axisMode={axisMode} />
            </div>
          )}
        </Section>

        <Section
          className="full"
          title="Projection"
          info={A.successRate}
          actions={
            <span className="pair">
              {simulating && <span className="badge">Simulating…</span>}
              {s.guardrails.enabled && (
                <span className="badge" title="Spending guardrails active — discretionary spending flexes with market performance">
                  Guardrails On
                </span>
              )}
              {result && (
                <span className="badge success">
                  Success {fmtPct(result.success_rate)}
                </span>
              )}
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
              startYear={s.sim.start_year}
              birthYear={s.profile.birth_year}
            />
          ) : (
            <p className="hint">Running first simulation…</p>
          )}
          <p className="hint">
            Set your stock/bond/cash mix in Market Model above, and your planned
            retirement age on the Freedom tab.
          </p>
        </Section>
      </Group>
    </div>
  );
}
