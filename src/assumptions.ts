// Short in-app versions of docs/ASSUMPTIONS.md, surfaced as ⓘ tips.
// Every entry here is rendered somewhere in the UI; keep them user-facing and
// concise — implementation detail belongs in the docs, not the tooltip.

export const A = {
  costBasis:
    "What you originally paid for the holdings in your brokerage account. When you sell, only the gain (value − basis) is taxed. Your brokerage reports this number — look for 'cost basis' on the positions page. If unsure, a lower basis is the conservative guess (more taxable gain).",
  rothBasis:
    "The total you've directly CONTRIBUTED to your Roth IRA over the years (not growth, not conversions). You can withdraw contributions at any age, tax- and penalty-free — which makes this number a key part of your early-retirement bridge. Your IRA provider can report lifetime contributions.",
  vol:
    "Volatility: the standard deviation of annual returns — how wildly the return swings year to year (historically ~17% for stocks, ~7% for bonds). Only used in Parametric mode; Bootstrap mode gets its variability from actual history.",
  cpiPlus:
    "Extra inflation on top of CPI for this stream. Healthcare costs historically grow ~1–2% faster than general inflation, so a healthcare stream might be CPI + 1.5%. Leave 0 for normal expenses.",
  hsaBuffer:
    "Dollars kept uninvested in the HSA (earning the cash rate) for near-term medical bills; everything above the buffer is invested at your allocation.",
  cagr:
    "Long-run average annual growth (geometric CAGR). Enter as Nominal (the headline number, e.g. ~9% for stocks) or Real (over inflation) — the toggle converts at your inflation assumption and stores the real figure. Historical US real: stocks ≈ 6.9%, 10-yr bonds ≈ 2.5% (Shiller 1871–2022); the defaults here are deliberately more conservative.",
  cash:
    "Your cash / high-yield savings (HYSA) return, modeled as inflation plus a small real spread so it tracks inflation the way savings rates actually do — in Nominal mode just enter today's APY (e.g. ~3% APY ≈ 0.5% real). Applies to your cash account and any uninvested surplus, and is taxed as ordinary interest.",
  bootstrap:
    "Bootstrap resamples ~5-year blocks of joint (stock, bond, inflation) history from Shiller 1871–2022, preserving correlations and real crash sequences. Parametric draws independent lognormal returns instead.",
  inflation:
    "Inflation follows an AR(1) process: high-inflation years cluster, like the 1970s or 2021–23. IID inflation would understate long-run purchasing-power risk.",
  expenseRatio:
    "The weighted average expense ratio of your funds (e.g. 0.05% for broad index funds). Charged each year as a drag on your invested (stock + bond) return; the cash pool is unaffected. Tiny for indexers, but it compounds over decades — and lets you see what higher-fee funds would cost.",
  legacy:
    "A floor on what you leave behind (today's dollars). A path counts as a success only if it funds all spending AND ends with at least this much real net worth — set it for a personal safety cushion, or an intended inheritance or donation. 0 = pure die-with-zero (any non-negative ending counts). Raising it lowers your success probability, FIRE number, and the retirement-age curve, because more of your money is now spoken for.",
  waterfall:
    "Each year's free cash flow (income − taxes − expenses) is allocated down this list. 'Max' = the IRS limit, which grows with inflation and includes age-based catch-ups. Contributions require wages. Add phases to change the routing at chosen ages — e.g. divert from the 401k to taxable while saving for a house.",
  policy:
    "In retirement, spending is funded by walking this list from the top. A path fails the first year spending can't be met.",
  ladder:
    "Conversions are ordinary income in the conversion year and become penalty-free after 5 calendar years (or at 59½, whichever comes first). 'Fill to bracket' tops up ordinary income to the chosen bracket each year — net of RMDs and the taxable part of Social Security. It's a lifetime tool: before 59½ it builds the penalty-free bridge; after, it keeps draining traditional cheaply to shrink RMDs at 75.",
  ss:
    "Two ways to set your benefit. 'From ssa.gov statement': enter the estimate at full retirement age (67) — but note it assumes you keep earning until you claim, so early retirement makes the real number lower. 'Estimate from my income': the app derives it from your plan's 35 highest earning years (covered wages, capped each year), counting the $0 years after you retire — the early-retiree correction the statement omits. Either way, the haircut models trust-fund risk and the claiming age (62–70) scales the benefit.",
  hsa:
    "Utilization = the share of medical expenses paid from the HSA each year (tax-free). At 65+, non-medical HSA withdrawals are penalty-free ordinary income, like a traditional IRA.",
  fireSimple:
    "25× annual retirement expenses (the 4% rule). Built on 30-year horizons — for a 50+ year early retirement, treat it as intuition, not a target.",
  fireMc:
    "The smallest portfolio for which retiring TODAY meets your success threshold. It scales your CURRENT account mix — hitting the same total at a later age usually isn't equivalent, because by then more of it sits in retirement accounts you can't freely touch before 59½. The When Can I Retire curve is the age-honest answer.",
  coast:
    "What you'd need invested today to reach your Monte-Carlo FIRE number — the smallest portfolio that retires at the coast age with at least your target success rate — with no further contributions, compounding at your blended real return.",
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
  sweep:
    "Success probability if you retire at each age, holding everything else constant (one shared set of market paths, so the curve is noise-free). Note: this can disagree with the FIRE number — by a later age your money is mostly in retirement accounts, so the same total is less accessible before 59½ than today's mix would be. New Salary events pinned after a candidate retirement age count as returning to work.",
  successCi:
    "This 95% interval is sampling error — how much the success estimate would wobble if you re-ran with different random draws. It is NOT a confidence interval on your real-life outcome. It narrows as you raise the number of paths; widen it before reading small differences as real.",
  endingBalance:
    "Distribution of net worth left at the horizon across all paths. A plan can clear the success bar yet leave a large median estate — that surplus is years of life traded for money you never spent. Read it alongside the success rate to judge over- vs under-saving. Honors the Today's-$ / Nominal toggle.",
  ruinAge:
    "For the paths that run short, the age at which spending first can't be met. 'When do plans die?' is more actionable than a single success number — late failures may be survivable by trimming; early ones are the real danger.",
  drawdown:
    "Each path's deepest peak-to-trough fall in REAL net worth. Computed in today's dollars so inflation's nominal growth can't hide a real decline. This is the dip you'd actually have to sit through without panic-selling.",
  maxSpend:
    "The most you could spend each year (today's $) and still clear your success threshold, flexing your living expenses (medical and loan payments held fixed). The mirror image of the FIRE number: 'how much can I spend?' instead of 'how much do I need?'.",
  maxSpendRetire:
    "Two answers (medical and loan payments held fixed). 'Now' flexes your living expenses across the whole plan — how much you can live on today while still retiring on time. 'In Retirement' flexes only retirement-and-later spending — the truer 'how much can I live on once I stop working' number. Both honor your success threshold and legacy floor.",
  surface:
    "Success probability across retirement age (x) and spending level (y, as a % of your planned living expenses), on one shared set of market paths. Read the whole trade-off at once: retire earlier by spending less, or spend more by working longer. The color flips at your success threshold.",
  tornado:
    "One-at-a-time sensitivity: each bar shows how far the success rate swings when that single input moves ±10% (retirement age moves ±2 years). The longest bar is the assumption that matters most — and the shortest ones you can stop worrying about. Note: Stock Volatility and Inflation only bite in Parametric market mode; in Bootstrap mode the historical data sets the spread, so those bars stay short.",
  aca:
    "Optional pre-65 health-insurance modeling. When you retire before Medicare, marketplace premiums are offset by an income-based subsidy. This uses the post-2021 rules: your expected contribution rises from 0% to a flat 8.5% of MAGI as income climbs, with no cliff at 400% of poverty — the subsidy is the benchmark (second-lowest Silver) premium minus that contribution, capped at your actual premium. Because MAGI includes Roth conversions and capital gains, this is where bracket-filling and healthcare cost directly trade off. Single-filer, with one benchmark premium rather than a full regional table.",
  irmaa:
    "Optional Medicare surcharge at 65+. Above income thresholds, Part B and D premiums carry an extra step-function charge (IRMAA). Defaults to the 2025 single-filer tiers. Real IRMAA keys off your MAGI from two years prior; this model uses the current year as a simplification, so a conversion spike shows its surcharge the same year.",
  stressTest:
    "What if your wages stopped for a few years — a layoff, a sabbatical, or your role being automated away? Re-runs the plan with salary zeroed for the chosen window (on the same market paths, so the change is pure income effect, not noise) and reports the hit to your success rate. A shock early in your career, when savings are thin, can fail outright — any year you can't cover essential spending counts as a failure, so this doubles as an emergency-fund check.",
  lifetimeTax:
    "The median total of every dollar of tax (federal + state + FICA + penalties) you pay across the whole plan, in today's dollars, and as a share of lifetime spending. This is the scoreboard for all the tax machinery — the ladder, withdrawal ordering, conversion targets. Lower is better, but only down to the point where chasing it starts shrinking lifestyle. Differences below ~1% are within the model's precision (flat state rate, no AMT/NIIT) — don't optimize past it.",
  effLifetimeTax:
    "The share of all the income you earn over your life that goes to income tax — total tax (federal + state + FICA + penalties) ÷ total gross income, on the median path. Far below your marginal rate; the honest 'how much of everything went to tax' number, and a fairer cross-plan comparison than the raw dollar total when incomes differ.",
  ladderSavings:
    "What the Roth conversion ladder, as configured, saves you in lifetime tax versus doing NO conversions at all — both run on the same market paths so the difference is pure strategy. Positive means the ladder pays off: convert cheaply in low-bracket bridge years instead of facing higher-taxed RMDs later. The single-number scoreboard for the whole ladder.",
  marginalCurve:
    "The marginal federal + state rate the NEXT dollar of ordinary income (a Roth conversion, an extra withdrawal) would face, year by year. Low-rate years are cheap to convert or realize income in; spikes are the Social Security 'torpedo' and RMDs stacking up. The reference lines mark the headline bracket rates. The torpedo worsens over time because the Social Security taxation thresholds are NOT inflation-indexed by law — so a real-dollar chart understates how much harder late conversions get.",
  healthcareTrajectory:
    "Net health-insurance cost per year after the ACA subsidy (pre-65) and the IRMAA surcharge (65+), with the subsidy shown alongside, on the median path in today's dollars. Because the subsidy shrinks as MAGI rises, a big Roth-conversion year shows up here as a cost spike — the collision the Taxes tab's ladder controls let you manage.",
  survival:
    "The share of Monte Carlo paths still funding spending by each age — the success rate as a function of time, not a single number. '95% funded at 80 but 78% at 90' tells you where the danger concentrates: late-life shortfalls may be survivable by trimming, early ones are the real hazard.",
  spendingDepth:
    "On the median path, how far guardrails flexed discretionary spending below (or above) plan each year, as a percentage of planned discretionary. A shallow, brief dip is a livable adjustment; a deep, chronic one is years of quiet belt-tightening the success rate alone hides. The floor and cap lines are your guardrail bounds (a cap above 100% means you've allowed spending the surplus).",
  failureSeverity:
    "Among only the paths that run short, how bad the shortfall is: the median total unmet spending (today's dollars) and how many years it lasts. A binary success rate treats a $500 miss at 89 and a decade-long collapse identically — this separates the survivable trims from the catastrophes.",
  bridgeDrawRate:
    "The share of your penalty-free accessible money you draw each year during the bridge (retirement to 59½), averaged across those years. High means the liquid runway is strained and a bad sequence could exhaust it before the locked accounts open; low is comfortable headroom. Each year is capped at 100% so the final, intentionally-drained year can't distort the average. Median path.",
  accountFlows:
    "One signed view of money moving through your accounts on the median path, today's dollars. Bars above zero are contributions (where each surplus dollar is saved); bars below zero are withdrawals (what's drawn from each account, in your Withdrawal-Policy order). Work income and Social Security ride as context lines, so the picture stays meaningful both before and after retirement.",
  spendingStrategy:
    "How much you spend each retirement year — distinct from the Withdrawal Policy, which only picks which account to tap. Steady Paycheck funds your plan's expense streams every year, optionally flexed by guardrails that trim or restore discretionary spending as your withdrawal rate runs hot or cool. Percent of Portfolio instead sets discretionary spending from a percentage of your accessible (penalty-free) wealth, so it self-corrects with the market and never depletes to zero — at the cost of a variable income; toggles let the rate rise with age (VPW), bound it to a floor and ceiling, or smooth it year to year. Either way, essentials are funded first, and a path still fails if accessible wealth can't cover them.",
  taxRegime:
    "Your whole low-bracket Roth-ladder strategy is a multi-decade bet that today's tax law holds. This re-runs the plan as if it reverts at the chosen age — ordinary brackets scaled up ~15% and the standard deduction roughly halved (a stand-in for a TCJA-style sunset, not an exact pre-2018 table) — and reports the hit to success and the rise in lifetime tax. The conversion ladder keeps filling to the same taxable-income ceiling; it just gets taxed harder. The biggest decades-scale risk the rest of the app can't see.",
  bridgeConfidence:
    "How confidently you can fund the years from early retirement to 59½ on penalty-free money alone. These columns isolate the bridge from longevity risk, so a plan that's fragile only in the early years can't hide behind a healthy overall success rate. A path that reaches 60 only by paying 10% early-withdrawal penalties already counts as a failure, not a success. The chart plots median penalty-free assets through the bridge in real (today's) dollars.",
  bridgeHolds:
    "Share of Monte Carlo paths whose penalty-free money LASTS to 59½ — no year went unfunded and no forced early-withdrawal penalty was needed (it's 1 − the break rate). This is the full simulation, so it DOES credit the Roth ladder maturing mid-bridge, market growth, and Social Security. It's the one bridge number to trust; the others are conservative day-one snapshots that ignore the ladder.",
  bridgeFunding:
    "The concrete liquidity target: a conversion you start at retirement doesn't season for 5 years, so the first ~5 retirement years must be funded entirely from already-liquid sources. It's the total real spending over that window PLUS the income, conversion, and capital-gains tax those years trigger — the 'exactly how much liquid do I need' answer the coverage ratio only gestures at.",
  bridgeCoverage:
    "Penalty-free assets the moment you retire ÷ everything the bridge to 59½ costs — not just spending, but the income, Roth-conversion and capital-gains tax those years realize (paid from the same accounts) — ignoring market growth. A floor, not a forecast. 1× means you could just reach 60 with markets flat; below 1× in the worst 5% means bad sequences force you onto growth or penalized withdrawals. A day-one snapshot that doesn't credit conversions maturing mid-bridge, so for a ladder-reliant plan it understates the real cushion — trust Bridge Holds for the verdict.",
  bridgeLiquidAvailable:
    "Your day-one penalty-free (liquid) assets — cash, taxable, and already-seasoned Roth basis you can spend before 59½ without a penalty — divided by Liquid Needed. At or above 1× your up-front liquid covers the unseasoned funding window outright; below 1× you lean on market growth, the maturing Roth ladder, or some income to close the gap. It's a day-one snapshot, so trust Bridge Holds for whether the bridge actually holds.",
  bridgeMinAccessible:
    "For each path, the lowest your penalty-free balance ever falls during the bridge. The mass near (or at) zero is the set of futures where you nearly — or actually — run out of reachable money before 59½. A thick left tail means the bridge is the fragile part of the plan.",
  bridgeCrash:
    "The early retiree's worst case: a market crash in the first years of retirement, when you're selling assets to live and the bridge has the longest way to go (sequence-of-returns risk, concentrated). Forces the chosen drop on the first years after your retirement age — on the same market paths, so the change is pure sequence effect — and reports the hit to overall success and to the bridge break and early-penalty rates.",
  frontier:
    "The die-with-zero answer to 'am I working longer than I need to.' For each retirement age, the green line is your success probability and the orange line is the median estate you'd die holding (today's $, right axis). The sweet spot is the earliest age where success clears your target but the estate hasn't started ballooning — every year past that is mostly funding an inheritance you didn't plan, not buying you security. Same shared market paths across all ages, so both curves are noise-free.",
  estateAboveLegacy:
    "Your median ending net worth minus your Legacy target — the money you're on track to leave beyond BOTH your own spending and the bequest you intend. The purest over-saving signal: a large number means years of work funding an estate nobody planned for. Set the Legacy target on the Assumptions tab; with it at 0 this equals the full median estate.",
  estateYears:
    "Your median ending net worth expressed as years of retirement spending — 'I'm on track to die with N years of spending I never used.' With no bequest goal, that's the headline over-saving number: years of working and saving converted into an estate instead of life. A few years is a sensible safety cushion; many years is a signal you could retire earlier or spend more.",
  growthMultiple:
    "Your median net worth at the horizon divided by your median net worth at retirement — how many times your nest egg multiplied AFTER you stopped contributing to it. Well above 1× means the portfolio grew faster than you drew it down: you lived on far less than it produced, the signature of over-saving. Around 1× (or below) is a true die-with-zero glidepath. Reads the median path, like the two tiles beside it — so on a high-volatility plan it can look large even while the unlucky tail runs short (see Undersaving).",
  fulfillment:
    "Bill Perkins' core idea: a dollar buys more living at 60 than at 88, because health and energy fade. The orange line re-weights your planned spending by an enjoyment factor — full through the go-go years (to 75), tapering to ~30% by 90 — so where it droops far below planned spending, you're funding years you can't fully enjoy. Flat or back-loaded spending is the warning sign; front-loaded (more travel/experiences early) is the die-with-zero ideal. The enjoyment curve is an assumption you can tune, not a fact.",
  tradOverfunding:
    "Whether you've locked too much in pre-tax accounts. From 75 the IRS forces a minimum withdrawal (RMD) whether you need it or not; where the gold RMD line rises above your spending, the red 'forced surplus' is ordinary income you must realize and pay tax on with nowhere to spend it — it just lands back in your taxable estate. A large or growing surplus means convert more during the low-bracket bridge years (Roth Conversion Ladder above) so less is trapped behind RMDs. Median path, today's dollars.",
  ltc:
    "Late-life care (in-home aide, assisted living, or nursing home), modeled as an essential, HSA-eligible, healthcare-inflating expense over the years you choose. A deterministic planning provision — size it to the care level and length you want covered. US medians run ~$70–120k/yr for a typical 2–3 year stay.",
  housing:
    "Your home as a first-class asset. Enter everything in today's dollars; the engine derives the nominal mortgage, the down payment, and the property-tax / insurance / maintenance costs from this one place, so nothing double-counts. The home's equity is reported in the 'Including Home' net-worth line but stays OUT of the FIRE-success math — you can't spend your house to fund retirement.",
  housingValue:
    "The home's purchase price in today's dollars. The engine grows it to the actual (nominal) price at your purchase age using your inflation and appreciation assumptions, so a future purchase is priced correctly. A frugal Madison-area single-family anchor is ≈ $350k.",
  housingAppreciation:
    "How fast the home's value grows ABOVE inflation. Long-run US home prices have roughly tracked inflation (≈ 0% real); 0 is a conservative default. A small positive premium (0.5–1%) reflects desirable markets. The mortgage is nominal, so even 0% real appreciation builds equity through principal paydown.",
  housingPropertyTax:
    "Annual property tax as a percent of the home's value. Dane County (Madison) runs ≈ 1.7% — among Wisconsin's highest and the largest ongoing cost of owning here. Charged every year you own, scaling with the home's value.",
  housingPmi:
    "Private mortgage insurance, charged when your down payment is under 20% (loan-to-value above 80%). It's an extra annual cost — a percent of the original loan — that automatically ends once you've paid the balance down to 78% of the home's value.",
  housingSale:
    "Optionally sell or downsize at a chosen age: the home's equity, net of selling costs and any capital-gains tax above the $250k single-filer exclusion, is moved into a liquid account — turning home equity into spendable wealth late in the plan.",
  housingItemize:
    "When on, the engine itemizes your mortgage interest plus (SALT-capped) property tax in years it beats the standard deduction — lowering taxable income, which matters most in your high-earning years and for Roth-conversion headroom. Off = always take the standard deduction.",
  housingRentVsBuy:
    "Compares buying (equity built, net of all ownership costs) against renting and investing the down payment plus any monthly cost difference at your market return. Both paths spend the same each year; the break-even is when buying overtakes renting. A flat home with strong markets can favor renting — this shows when.",
  housingEquity:
    "Your home's value, the mortgage you still owe, and the equity between them (value − mortgage) over time. Equity grows two ways: the mortgage amortizing down, and the home appreciating. This equity feeds the 'Including Home' net-worth line but never the spendable-portfolio math.",
};
