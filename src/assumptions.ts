// Short in-app versions of docs/ASSUMPTIONS.md, surfaced as ⓘ tips.

export const A = {
  realDollars:
    "All inputs are in today's dollars. The engine simulates in nominal dollars (taxes and limits are nominal) and converts back for 'real' views.",
  cagr:
    "Enter geometric (CAGR) real returns, not arithmetic means. Historical US: stocks ≈ 6.9% real CAGR, 10yr bonds ≈ 2.5% (Shiller 1871–2022). Defaults are deliberately more conservative.",
  bootstrap:
    "Bootstrap resamples ~5-year blocks of joint (stock, bond, inflation) history from Shiller 1871–2022, preserving correlations and real crash sequences. Parametric draws independent lognormal returns instead.",
  inflation:
    "Inflation follows an AR(1) process: high-inflation years cluster, like the 1970s or 2021–23. IID inflation would understate long-run purchasing-power risk.",
  crash:
    "Crash events replace that year's sampled return — a deterministic stress test. Random crashes are not injected: history-calibrated returns already contain them.",
  taxes:
    "Federal: 2026 single brackets + standard deduction + LTCG stacking, inflation-indexed. State: flat rate on federal taxable income. No AMT/NIIT/itemizing.",
  waterfall:
    "Each year's free cash flow (income − taxes − expenses) is allocated down this list. 'Max' = the IRS limit, which grows with inflation and includes age-based catch-ups. Contributions require wages.",
  policy:
    "In retirement, spending is funded by walking this list. 59½ is modeled as age 60. A path fails the first year spending can't be met.",
  ladder:
    "Conversions are ordinary income in the conversion year and become penalty-free after 5 calendar years. 'Fill to bracket' converts up to the chosen bracket top each year — the classic ladder.",
  ss:
    "Enter your ssa.gov estimate at full retirement age (67). Caution: that estimate assumes you keep earning until claiming — early retirement makes the real number lower. Use the haircut to absorb both trust-fund risk and that gap.",
  hsa:
    "Utilization = the share of medical expenses paid from the HSA each year (tax-free). At 65+, non-medical HSA withdrawals are penalty-free ordinary income, like a traditional IRA.",
  fireSimple:
    "25× annual retirement expenses (the 4% rule). Built on 30-year horizons — for a 50+ year early retirement, treat it as intuition, not a target.",
  fireMc:
    "The smallest portfolio for which retiring TODAY meets your success threshold, found by bisecting Monte Carlo runs. This is the number to trust.",
  coast:
    "What you'd need today to hit 25× expenses by the coast age with zero further contributions, compounding at your blended real CAGR (deterministic).",
  accessibility:
    "Median accessible (penalty-free) dollars by source. The early-retirement bridge: cash + taxable + Roth contributions + matured ladder rungs must cover spending until 59½.",
  successRate:
    "Share of Monte Carlo paths that never fail to fund spending through the horizon. With guardrails off, this assumes you'd march off a cliff at fixed spending — pessimistic. Turn on spending guardrails (Inputs) for a more realistic picture.",
  guardrails:
    "Guyton-Klinger-style rules: if planned spending / portfolio drifts 20% above the rate at retirement, discretionary spending is cut 10% (floored); if it drifts 20% below, spending is restored (capped at plan). Typically worth +5 to +15pp of success at marginal withdrawal rates.",
  events:
    "Events change the simulation from their date forward: one-time flows (positive = expense, negative = windfall), regime changes (salary/allocation), and market crashes.",
  snapshots:
    "Record your actual balances over time and watch reality thread through the projection cone — the best calibration check on your assumptions.",
};
