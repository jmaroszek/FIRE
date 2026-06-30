import React, { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { A } from "../assumptions";
import { ACCOUNT_LABELS } from "../labels";
import { SeriesChart, PercentileFanChart } from "../components/charts";
import { lifeStageMarkers, xValues } from "../components/chartShared";
import {
  Field, HeroRow, HeroStat, InfoTip, NumberInput, PercentInput, Section, SectionNav,
  Stat, fmtMoney, fmtPct,
} from "../components/ui";
import { useStore } from "../store";
import { DEFAULT_HOUSING } from "../types";
import type { AccountType, HousingConfig, Scenario, SimulateResult } from "../types";
import { amortize, rentVsBuy } from "../housing";

/** Section heading that doubles as a scroll anchor for the in-page sub-nav. */
function Head({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 className="group-title" id={id} style={{ scrollMarginTop: 96 }}>{children}</h2>;
}

const CASH_OR_BROKERAGE: AccountType[] = ["taxable", "cash"];

export default function Housing() {
  const { scenario, result, axisMode } = useStore(useShallow((s) => ({
    scenario: s.scenario, result: s.result, axisMode: s.axisMode,
  })));
  const setScenario = useStore((s) => s.setScenario);
  const [rent, setRent] = useState(1500); // today's $/mo — a rent-vs-buy what-if, not stored

  if (!scenario) return null;
  const s = scenario;
  const h: HousingConfig = s.housing ?? DEFAULT_HOUSING;
  const startAge = s.sim.start_year - s.profile.birth_year;
  const up = (patch: Partial<Scenario>) => setScenario({ ...s, ...patch });
  const upH = (patch: Partial<HousingConfig>) => up({ housing: { ...h, ...patch } });

  // Client-side amortization powers the headline stats and the loan comparison —
  // instant what-ifs that never round-trip the engine.
  const loanTerms = {
    price: h.home_price, downPct: h.down_payment_pct, rate: h.mortgage_rate,
    termYears: h.loan_term_years, points: h.points, type: h.loan_type,
    armFixedYears: h.arm_fixed_years, armResetRate: h.arm_reset_rate,
  };
  const amort = amortize(loanTerms);
  const payoffAge = h.purchase_age + amort.payoffYear;
  const hasHome = h.enabled && (result?.home_value_real?.length ?? 0) > 0;

  // Equity at retirement, pulled from the engine's plan-of-record home when present.
  const retIdx = result ? (s.retirement_age - startAge) + 1 : -1; // home series are T+1 (xValues offset)
  const equityAtRet = hasHome && retIdx >= 0 && retIdx < (result!.home_equity_real!.length)
    ? result!.home_equity_real![retIdx] : null;

  const subNav = [
    { id: "house-config", label: "Home & Mortgage" },
    ...(hasHome ? [{ id: "house-equity", label: "Equity Over Time" }] : []),
    ...(h.enabled ? [
      { id: "house-compare", label: "Loan Comparison" },
      { id: "house-rentbuy", label: "Rent vs Buy" },
    ] : []),
  ];

  return (
    <div className="stack">
      {h.enabled && <SectionNav items={subNav} />}

      {/* ───────────── HOME & MORTGAGE ───────────── */}
      {h.enabled && <Head id="house-config">Home &amp; Mortgage</Head>}
      <Section title="Your Home" info={A.housing} className={!h.enabled ? "housing-empty-card" : undefined}
        actions={h.enabled ? (
          <label className="field" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <span className="field-label" style={{ margin: 0 }}>Enable Housing</span>
            <input type="checkbox" checked={h.enabled}
              onChange={(e) => upH({ enabled: e.target.checked })} />
          </label>
        ) : undefined}>
        {!h.enabled ? (
          <div className="housing-empty">
            <label className="housing-enable">
              <span>Enable Housing</span>
              <input type="checkbox" checked={h.enabled}
                onChange={(e) => upH({ enabled: e.target.checked })} />
            </label>
            <p className="hint">
              Turn on Housing to model a home purchase from today's-dollar inputs.
              The plan will derive the mortgage, down payment, property tax,
              insurance, and maintenance costs. It also tracks home equity in a
              separate "net worth including home" line, without counting the house
              as spendable retirement money.
            </p>
          </div>
        ) : (
          <>
            <HeroRow>
              <HeroStat label="Monthly Payment" value={fmtMoney(amort.monthly)} tone="accent"
                sub={`${fmtMoney(amort.loan)} loan at ${fmtPct(h.mortgage_rate)}`} />
              <HeroStat label="Total Interest" value={fmtMoney(amort.totalInterest)} tone="amber"
                sub={`over a ${h.loan_term_years}-year term`} />
              <HeroStat label="Paid Off At Age" value={String(payoffAge)} tone="green"
                sub={`${amort.payoffYear} years after purchase`} />
              <HeroStat label="Equity At Retirement"
                value={equityAtRet != null ? fmtMoney(equityAtRet) : "—"} tone="purple"
                info={A.housingEquity}
                sub={equityAtRet != null ? "today's $, median path" : "simulation pending…"} />
            </HeroRow>

            <div className="housing-home-layout">
              <div className="housing-home-controls">
                <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Purchase</h3>
                <div className="fields">
                  <Field label="Purchase Age"
                    info="The age you buy. The home and mortgage appear on your net worth at this age; the down payment comes out of the account below. v1 models a fresh purchase from today onward.">
                    <NumberInput value={h.purchase_age} step={1} min={startAge}
                      max={s.profile.horizon_age} onChange={(v) => upH({ purchase_age: v })} />
                  </Field>
                  <Field label="Home Price (Today's $)" info={A.housingValue}>
                    <NumberInput value={h.home_price} step={10000} min={0}
                      onChange={(v) => upH({ home_price: v })} />
                  </Field>
                  <Field label="Down Payment" info="Share of the price paid up front. Under 20% adds PMI (below).">
                    <PercentInput value={h.down_payment_pct} step={1}
                      onChange={(v) => upH({ down_payment_pct: v })} />
                  </Field>
                  <Field label="Closing Costs" info="One-time costs at purchase (title, fees, escrow) as a percent of price.">
                    <PercentInput value={h.closing_costs_pct} step={0.5}
                      onChange={(v) => upH({ closing_costs_pct: v })} />
                  </Field>
                  <Field label="Down Payment From"
                    info="Where the down payment and closing costs come from. Pick a single account (selling those assets may realize taxable gains), or Withdrawal Policy to draw across your accounts in the order set on the Accounts tab.">
                    <select value={h.down_payment_account ?? ""}
                      onChange={(e) => upH({ down_payment_account: (e.target.value || null) as AccountType | null })}>
                      <option value="">Withdrawal Policy</option>
                      {CASH_OR_BROKERAGE.map((a) => <option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>)}
                    </select>
                  </Field>
                </div>

                <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Mortgage</h3>
                <div className="fields">
                  <Field label="Loan Term (Years)">
                    <NumberInput value={h.loan_term_years} step={5} min={1}
                      onChange={(v) => upH({ loan_term_years: v })} />
                  </Field>
                  <Field label="Loan Type"
                    info="Fixed holds the rate for the whole term. ARM holds the initial rate for a fixed period, then resets once to the rate below (no annual caps modeled).">
                    <select value={h.loan_type}
                      onChange={(e) => upH({ loan_type: e.target.value as "fixed" | "arm" })}>
                      <option value="fixed">Fixed</option>
                      <option value="arm">Adjustable (ARM)</option>
                    </select>
                  </Field>
                  <Field label={h.loan_type === "arm" ? "Initial Rate" : "Mortgage Rate"}>
                    <PercentInput value={h.mortgage_rate} step={0.125}
                      onChange={(v) => upH({ mortgage_rate: v })} />
                  </Field>
                  <Field label="Points"
                    info="Discount points: each is 1% of the loan paid up front to buy down the rate. Enter the number of points (e.g. 1 = 1% of the loan).">
                    <NumberInput value={h.points} step={0.25} min={0}
                      onChange={(v) => upH({ points: v })} />
                  </Field>
                  {h.loan_type === "arm" && (
                    <>
                      <Field label="Fixed Period (Years)" info="Years the initial rate holds before the reset.">
                        <NumberInput value={h.arm_fixed_years} step={1} min={1}
                          onChange={(v) => upH({ arm_fixed_years: v })} />
                      </Field>
                      <Field label="Reset Rate">
                        <PercentInput value={h.arm_reset_rate} step={0.125}
                          onChange={(v) => upH({ arm_reset_rate: v })} />
                      </Field>
                    </>
                  )}
                </div>

                <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Carrying Costs &amp; Value</h3>
                <div className="fields">
                  <Field label="Property Tax Rate" info={A.housingPropertyTax}>
                    <PercentInput value={h.property_tax_rate} step={0.1}
                      onChange={(v) => upH({ property_tax_rate: v })} />
                  </Field>
                  <Field label="Insurance / Year (Today's $)">
                    <NumberInput value={h.insurance_annual} step={100} min={0}
                      onChange={(v) => upH({ insurance_annual: v })} />
                  </Field>
                  <Field label="Maintenance / Year"
                    info="Upkeep as a percent of home value — the '1% rule' is a common estimate.">
                    <PercentInput value={h.maintenance_pct} step={0.25}
                      onChange={(v) => upH({ maintenance_pct: v })} />
                  </Field>
                  <Field label="Appreciation (Real)" info={A.housingAppreciation}>
                    <PercentInput value={h.appreciation_real} step={0.25}
                      onChange={(v) => upH({ appreciation_real: v })} />
                  </Field>
                  {h.down_payment_pct < 0.2 && (
                    <Field label="PMI Rate" info={A.housingPmi}>
                      <PercentInput value={h.pmi_rate} step={0.05}
                        onChange={(v) => upH({ pmi_rate: v })} />
                    </Field>
                  )}
                  <Field label="Itemize Deductions" info={A.housingItemize}>
                    <input type="checkbox" checked={h.itemize_deductions}
                      onChange={(e) => upH({ itemize_deductions: e.target.checked })} />
                  </Field>
                </div>

                <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>
                  Sale / Downsize <InfoTip text={A.housingSale} />
                </h3>
                <div className="fields">
                  <Field label="Sell At Age" info="Leave blank to hold the home through the horizon. Set an age to sell and move the net equity into a liquid account.">
                    <NumberInput value={h.sale_age ?? 0} step={1} min={0}
                      onChange={(v) => upH({ sale_age: v > h.purchase_age ? v : null })} />
                  </Field>
                  {h.sale_age != null && (
                    <>
                      <Field label="Selling Costs" info="Realtor commission + closing at sale, as a percent of the sale price.">
                        <PercentInput value={h.selling_costs_pct} step={0.5}
                          onChange={(v) => upH({ selling_costs_pct: v })} />
                      </Field>
                      <Field label="Cap-Gains Exclusion (Today's $)"
                        info="Tax-free gain on a primary residence — $250k for a single filer (§121). Gain above this is taxed at the rate beside it.">
                        <NumberInput value={h.cap_gains_exclusion} step={50000} min={0}
                          onChange={(v) => upH({ cap_gains_exclusion: v })} />
                      </Field>
                      <Field label="Cap-Gains Rate">
                        <PercentInput value={h.cap_gains_rate} step={1}
                          onChange={(v) => upH({ cap_gains_rate: v })} />
                      </Field>
                      <Field label="Proceeds To">
                        <select value={h.sale_proceeds_account}
                          onChange={(e) => upH({ sale_proceeds_account: e.target.value as AccountType })}>
                          {CASH_OR_BROKERAGE.map((a) => <option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>)}
                        </select>
                      </Field>
                    </>
                  )}
                </div>
                <p className="hint" style={{ marginTop: 12 }}>
                  Home equity is reported in the "Net Worth (Including Home)" projection
                  below and on the Accounts tab — but it never funds the FIRE-success
                  math. You can't eat your house.
                </p>
              </div>
              <div className="housing-loan-compare" id="house-compare">
                <h3>
                  Compare Loan Options
                  <InfoTip text="Side-by-side what-ifs on the same price and down payment: term, rate, ARM, and points. Instant — these don't change your saved plan." />
                </h3>
                <div className="housing-table-scroll">
                  <LoanComparison terms={loanTerms} rate={h.mortgage_rate} armReset={h.arm_reset_rate} />
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  Payments are accurate monthly figures (what a lender quotes). The plan
                  projection above uses an annual approximation, so the two can differ by a rounding.
                </p>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ───────────── EQUITY OVER TIME ───────────── */}
      {hasHome && result && (
        <>
          <Head id="house-equity">Equity Over Time</Head>
          <div className="group-grid stretch">
            <Section title="Home Value, Mortgage & Equity" className="span2" info={A.housingEquity}>
              <SeriesChart
                x={xValues(result, axisMode)} axisMode={axisMode} yFormat="money"
                title="" hideXTitle
                series={[
                  { name: "Home Value", values: result.home_value_real!, color: "#3fb950" },
                  { name: "Mortgage Owed", values: result.home_mortgage_real!, color: "#ff7b72" },
                  { name: "Home Equity", values: result.home_equity_real!, color: "#58a6ff", fill: true },
                ]}
                markers={lifeStageMarkers(axisMode, s.profile.birth_year, [
                  { age: h.purchase_age, label: "Buy", color: "#8b949e" },
                  ...(h.sale_age != null ? [{ age: h.sale_age, label: "Sell", color: "#f0883e" }] : []),
                ])}
              />
            </Section>

            <Section title="Net Worth With Home Equity" className="span1"
              info="Your financial net worth plus home equity, in today's dollars. The home lifts this line above the spendable-only net worth used everywhere else — the gap is your house.">
              {result.net_worth_incl_home && Object.keys(result.net_worth_incl_home).length > 0 ? (
                <PercentileFanChart
                  x={xValues(result, axisMode)} fan={result.net_worth_incl_home}
                  axisMode={axisMode} yFormat="money" title="" color="#3fb950"
                  showOuterBand={false} hideXTitle
                  markers={lifeStageMarkers(axisMode, s.profile.birth_year, [
                    { age: s.retirement_age, label: `Retire ${s.retirement_age}`, color: "#d29922" },
                  ])}
                />
              ) : <p className="hint">Simulation pending…</p>}
            </Section>
          </div>
        </>
      )}

      {/* ───────────── RENT VS BUY ───────────── */}
      {h.enabled && (
        <>
          <Head id="house-rentbuy">Rent vs Buy</Head>
          <Section title="Rent vs Buy" info={A.housingRentVsBuy}>
            <div className="fields">
              <Field label="Monthly Rent (Today's $)"
                info="What you'd pay to rent a comparable place instead. The renter invests the down payment, closing costs, and any month it's cheaper to rent than own.">
                <NumberInput value={rent} step={100} min={0} onChange={setRent} />
              </Field>
            </div>
            <RentVsBuyView scenario={s} housing={h} rent={rent} axisMode={axisMode} result={result} />
          </Section>
        </>
      )}
    </div>
  );
}

/** A small static comparison of the current loan against common alternatives. */
function LoanComparison({ terms, rate, armReset }:
  { terms: Parameters<typeof amortize>[0]; rate: number; armReset: number }) {
  const variants = [
    { label: "30-Year Fixed", t: { ...terms, termYears: 30, type: "fixed" as const, points: 0 } },
    { label: "15-Year Fixed", t: { ...terms, termYears: 15, type: "fixed" as const, points: 0 } },
    { label: "30-Year, 1 Point", t: { ...terms, termYears: 30, type: "fixed" as const, points: 1, rate: Math.max(rate - 0.0025, 0) } },
    { label: `5/1 ARM → ${fmtPct(armReset)}`, t: { ...terms, termYears: 30, type: "arm" as const, armFixedYears: 5, armResetRate: armReset, points: 0 } },
  ];
  const rows = variants.map((v) => ({ label: v.label, r: amortize(v.t) }));
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Option</th><th>Monthly</th><th>Annual</th><th>Total Interest</th>
          <th>Equity At 10 Yrs<InfoTip text="Principal paid down 10 years in (excludes appreciation), on the same price and down payment." /></th>
          <th>Payoff (Yrs)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const tenYr = row.r.schedule[Math.min(10, row.r.schedule.length - 1)];
          const equity10 = (terms.price - row.r.loan) + (row.r.loan - tenYr.balance);
          return (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{fmtMoney(row.r.monthly)}</td>
              <td>{fmtMoney(row.r.monthly * 12)}</td>
              <td>{fmtMoney(row.r.totalInterest)}</td>
              <td>{fmtMoney(equity10)}</td>
              <td>{row.r.payoffYear}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Rent-vs-buy wealth trajectories. The invested-alternative return is the plan's
 *  ACTUAL realized real return (median path) — correct in every market mode,
 *  including Historical Bootstrap, where the entered CAGRs are ignored. Falls back
 *  to the allocation-blended CAGR only before the first simulation lands. */
function RentVsBuyView({ scenario, housing, rent, axisMode, result }:
  { scenario: Scenario; housing: HousingConfig; rent: number; axisMode: "age" | "year";
    result: SimulateResult | null }) {
  const a = scenario.allocation;
  const m = scenario.market;
  // The plan's actual typical real CAGR (median path) — correct in every market
  // mode, including Bootstrap where the entered CAGRs are ignored. Falls back to
  // the allocation-blended CAGR only before the first simulation lands.
  const investReturnReal = result?.median_real_return ??
    (a.stocks * m.stocks.real_cagr + a.bonds * m.bonds.real_cagr + a.cash * m.cash.real_cagr);
  // Compare over a realistic holding period: until you sell if set, else the loan
  // term (the natural ownership commitment) — not the whole plan horizon, which
  // would let 50+ years of market compounding swamp the decision.
  const years = Math.max(1, Math.min(
    housing.sale_age != null ? housing.sale_age - housing.purchase_age : housing.loan_term_years,
    scenario.profile.horizon_age - housing.purchase_age,
  ));
  const r = rentVsBuy({
    price: housing.home_price, downPct: housing.down_payment_pct,
    closingPct: housing.closing_costs_pct, rate: housing.mortgage_rate,
    termYears: housing.loan_term_years, propertyTaxRate: housing.property_tax_rate,
    insuranceAnnual: housing.insurance_annual, maintenancePct: housing.maintenance_pct,
    appreciationReal: housing.appreciation_real, inflation: scenario.inflation.mean,
    investReturnReal, monthlyRent: rent, sellingCostsPct: housing.selling_costs_pct, years,
  });
  const x = r.buyWealthReal.map((_, i) =>
    axisMode === "age" ? housing.purchase_age + i
      : scenario.profile.birth_year + housing.purchase_age + i);
  const aheadAtEnd = r.buyWealthReal[years] - r.rentWealthReal[years];
  return (
    <>
      <div className="stat-grid" style={{ marginTop: 20, marginBottom: 12 }}>
        <Stat label="Break-Even"
          value={r.breakEvenYear != null ? `${r.breakEvenYear} yrs` : "Never (in horizon)"}
          sub={r.breakEvenYear != null ? `buying overtakes renting at age ${housing.purchase_age + r.breakEvenYear}` : "renting stays ahead through the horizon"} />
        <Stat label="At The Horizon"
          value={`${aheadAtEnd >= 0 ? "Buying" : "Renting"} +${fmtMoney(Math.abs(aheadAtEnd))}`}
          sub="advantage in net wealth, today's $" />
        <Stat label="Assumed Market Return"
          value={fmtPct(investReturnReal)} sub="real, your allocation's blend" />
      </div>
      <SeriesChart
        x={x} axisMode={axisMode} yFormat="money" title="" hideXTitle
        series={[
          { name: "Buy (net equity)", values: r.buyWealthReal, color: "#3fb950" },
          { name: "Rent + Invest", values: r.rentWealthReal, color: "#58a6ff" },
        ]}
      />
    </>
  );
}
