// Short in-app versions of docs/ASSUMPTIONS.md, surfaced as ⓘ tips.

export const A = {
  costBasis:
    "What you originally paid for the holdings in your brokerage account. When you sell, only the gain (value − basis) is taxed. Your brokerage reports this number — look for 'cost basis' on the positions page. If unsure, a lower basis is the conservative guess (more taxable gain).",
  rothBasis:
    "The total you've directly CONTRIBUTED to your Roth IRA over the years (not growth, not conversions). You can withdraw contributions at any age, tax- and penalty-free — which makes this number a key part of your early-retirement bridge. Your IRA provider can report lifetime contributions.",
  vol:
    "Volatility: the standard deviation of annual returns — how wildly the return swings year to year (historically ~17% for stocks, ~7% for bonds). Only used in Parametric mode; Bootstrap mode gets its variability from actual history.",
  cpiPlus:
    "Extra inflation on top of CPI for this stream. Healthcare costs historically grow ~1–2% faster than general inflation, so a healthcare stream might be CPI + 1.5%. Leave 0 for normal expenses.",
  inflatesFlag:
    "Checked: the amount rises with inflation (most living costs). Unchecked: fixed in nominal dollars forever — right for a fixed-rate mortgage or loan payment, which inflation slowly erodes.",
  hsaEligible:
    "Marks this stream as payable from your HSA. The HSA Utilization setting then decides what share actually comes out of the HSA (tax-free) vs out of pocket — no double counting either way.",
  growthMode:
    "Nominal: the raise number on your review letter (e.g. 3%) — the engine subtracts expected inflation to get real growth. Real: growth above inflation, used as-is.",
  hsaBuffer:
    "Dollars kept uninvested in the HSA (earning the cash rate) for near-term medical bills; everything above the buffer is invested at your allocation.",
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
    "Conversions are ordinary income in the conversion year and become penalty-free after 5 calendar years (or at 59½, whichever comes first). 'Fill to bracket' tops up ordinary income to the chosen bracket each year — net of RMDs and the taxable part of Social Security. It's a lifetime tool: before 59½ it builds the penalty-free bridge; after, it keeps draining traditional cheaply to shrink RMDs at 75.",
  ss:
    "Enter your ssa.gov estimate at full retirement age (67). Caution: that estimate assumes you keep earning until claiming — early retirement makes the real number lower. Use the haircut to absorb both trust-fund risk and that gap.",
  hsa:
    "Utilization = the share of medical expenses paid from the HSA each year (tax-free). At 65+, non-medical HSA withdrawals are penalty-free ordinary income, like a traditional IRA.",
  fireSimple:
    "25× annual retirement expenses (the 4% rule). Built on 30-year horizons — for a 50+ year early retirement, treat it as intuition, not a target.",
  fireMc:
    "The smallest portfolio for which retiring TODAY meets your success threshold, found by bisecting Monte Carlo runs. It scales your CURRENT account mix — hitting the same total at a later age usually isn't equivalent, because by then more of it sits in retirement accounts you can't freely touch before 59½. The When Can I Retire curve is the age-honest answer.",
  coast:
    "What you'd need today to hit 25× expenses by the coast age with zero further contributions, compounding at your blended real CAGR (deterministic).",
  accessibility:
    "Median accessible (penalty-free) dollars by source. The early-retirement bridge: cash + taxable + Roth contributions + matured ladder rungs must cover spending until 59½.",
  successRate:
    "Share of Monte Carlo paths that never fail to fund spending through the horizon.",
  guardrails:
    "Guyton-Klinger-style rules: if planned spending / portfolio drifts 20% above the rate at retirement, discretionary spending is cut 10% (floored); if it drifts 20% below, spending is restored (capped at plan). Typically worth +5 to +15pp of success at marginal withdrawal rates.",
  events:
    "Events change the simulation from their date forward: one-time flows (positive = expense, negative = windfall), regime changes (salary/allocation), and market crashes.",
  snapshots:
    "Record your actual balances over time.",
  liabilities:
    "Loans with fixed nominal payments: mortgage, car, business loans. The payment is an essential, non-inflating expense until the amortization (balance × rate − payment) hits zero; the outstanding balance is subtracted from net worth. Loans never inflate — that's the upside of fixed-rate debt.",
  investing:
    "How much the plan saves each year, by destination — the median path in today's dollars. Anything left after taxes and expenses is assumed saved: first down your contribution waterfall, then any unallocated surplus pools in Cash. If the Cash band looks large, your waterfall isn't capturing your full surplus.",
  sweep:
    "Success probability if you retire at each age, holding everything else constant (one shared set of market paths, so the curve is noise-free). Note: this can disagree with the FIRE number — by a later age your money is mostly in retirement accounts, so the same total is less accessible before 59½ than today's mix would be. New Salary events pinned after a candidate retirement age count as returning to work.",
  actualsVsProjection:
    "Your recorded snapshots plotted over the projection cone — watch reality thread through the bands.",
};
