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
    "Long-run average annual growth (geometric CAGR, not an arithmetic mean). Enter returns as Nominal (the headline number, e.g. ~9% stocks) or Real (over inflation) — the toggle converts at your inflation assumption and stores the real figure either way, so changing inflation later re-expresses the nominal number without moving your real return or wealth. Historical US real: stocks ≈ 6.9% CAGR, 10yr bonds ≈ 2.5% (Shiller 1871–2022). Defaults are deliberately more conservative.",
  cash:
    "Your cash / high-yield savings (HYSA) return. Modeled as inflation plus a real spread, so it tracks inflation the way savings rates actually do — in Nominal mode just enter today's APY (e.g. ~3% APY ≈ 0.5% real). Applies to your Cash account and any uninvested surplus, and it's taxed as ordinary interest. Historically cash has roughly kept pace with inflation (~0.5% real).",
  bootstrap:
    "Bootstrap resamples ~5-year blocks of joint (stock, bond, inflation) history from Shiller 1871–2022, preserving correlations and real crash sequences. Parametric draws independent lognormal returns instead.",
  inflation:
    "Inflation follows an AR(1) process: high-inflation years cluster, like the 1970s or 2021–23. IID inflation would understate long-run purchasing-power risk.",
  crash:
    "Crash events replace that year's sampled return — a deterministic stress test. Random crashes are not injected: history-calibrated returns already contain them.",
  taxes:
    "Federal: 2026 single brackets + standard deduction + LTCG stacking, inflation-indexed. State: flat rate on federal taxable income. No AMT/NIIT/itemizing.",
  waterfall:
    "Each year's free cash flow (income − taxes − expenses) is allocated down this list. 'Max' = the IRS limit, which grows with inflation and includes age-based catch-ups. Contributions require wages. Add phases to change the routing at chosen ages — e.g. divert from the 401k to taxable while saving for a house.",
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
  sweep:
    "Success probability if you retire at each age, holding everything else constant (one shared set of market paths, so the curve is noise-free). Note: this can disagree with the FIRE number — by a later age your money is mostly in retirement accounts, so the same total is less accessible before 59½ than today's mix would be. New Salary events pinned after a candidate retirement age count as returning to work.",
  actualsVsProjection:
    "Your recorded snapshots plotted over the projection cone — watch reality thread through the bands.",
  successCi:
    "The 95% interval is Monte-Carlo SAMPLING error: how much the success estimate would wobble from re-running with a different random seed at this path count. It is NOT a confidence interval on your real-life outcome. It shrinks as you raise the number of paths — widen it before reading small differences as real (a Wilson score interval, so it never spills past 100%).",
  endingBalance:
    "Distribution of net worth left at the horizon across all paths. A plan can clear the success bar yet leave a large median estate — that surplus is years of life traded for money you never spent. Read it alongside the success rate to judge over- vs under-saving. Honors the Today's-$ / Nominal toggle.",
  spendingDelivered:
    "Total lifestyle actually funded over the whole plan, in today's dollars, per path. With guardrails on, bad markets cut discretionary spending — two plans can both 'succeed' while one quietly under-delivers for years. The companion stat counts the years a path spent in a guardrail cut.",
  ruinAge:
    "For the paths that run short, the age at which spending first can't be met. 'When do plans die?' is more actionable than a single success number — late failures may be survivable by trimming; early ones are the real danger.",
  drawdown:
    "Each path's deepest peak-to-trough fall in REAL net worth. Computed in today's dollars so inflation's nominal growth can't hide a real decline. This is the dip you'd actually have to sit through without panic-selling.",
  sequenceRisk:
    "Each dot is one path: its average real return over the first few years (x) vs. the wealth it ended with (y), colored by whether it survived. The cloud tilts right because a weak first decade is far harder to recover from than a weak later one — sequence-of-returns risk, the early retiree's central hazard.",
  vsPlan:
    "Where your latest recorded snapshot lands within the original projection cone for that year (compared in nominal dollars, so inflation doesn't matter). 'Tracking ≈ 60th percentile' means you're ahead of the median path the plan drew at the start.",
  maxSpend:
    "The most you could spend each year (today's $) and still clear your success threshold — found by bisecting Monte Carlo runs on your flexible living expenses (medical and loan payments held fixed). The mirror image of the FIRE number: 'how much can I spend?' instead of 'how much do I need?'.",
  maxSpendRetire:
    "Two answers from the same bisection (medical and loan payments held fixed). 'Now' flexes your living expenses across the whole plan — how much you can live on today while still retiring on time. 'In Retirement' flexes only retirement-and-later spending — the truer 'how much can I live on once I stop working' number. Both honor your success threshold and legacy floor.",
  legacy:
    "A floor on what you leave behind (today's dollars). A path counts as a success only if it funds all spending AND ends with at least this much real net worth — set it for a personal safety cushion, or an intended inheritance or donation. 0 = pure die-with-zero (any non-negative ending counts). Raising it lowers your success probability, FIRE number, and the retirement-age curve, because more of your money is now spoken for.",
  expenseRatio:
    "The weighted average expense ratio of your funds (e.g. 0.05% for broad index funds). Charged each year as a drag on your invested (stock + bond) return; the cash pool is unaffected. Tiny for indexers, but it compounds over decades — and lets you see what higher-fee funds would cost.",
  surface:
    "Success probability across retirement age (x) and spending level (y, as a % of your planned living expenses), on one shared set of market paths. Read the whole trade-off at once: retire earlier by spending less, or spend more by working longer. The color flips at your success threshold.",
  tornado:
    "One-at-a-time sensitivity: each bar shows how far the success rate swings when that single input moves ±10% (retirement age moves ±2 years). The longest bar is the assumption that matters most — and the shortest ones you can stop worrying about. Note: Stock Volatility and Inflation only bite in Parametric market mode; in Bootstrap mode the historical data sets the spread, so those bars stay short.",
  aca:
    "Optional pre-65 health-insurance modeling. When you retire before Medicare, marketplace premiums are offset by an income-based subsidy. This uses the post-2021 rules: your expected contribution rises from 0% to a flat 8.5% of MAGI as income climbs, with no cliff at 400% of poverty — the subsidy is the benchmark (second-lowest Silver) premium minus that contribution, capped at your actual premium. Because MAGI includes Roth conversions and capital gains, this is where bracket-filling and healthcare cost directly trade off. Single-filer; one benchmark instead of a full regional table (ASSUMPTIONS #26).",
  irmaa:
    "Optional Medicare surcharge at 65+. Above income thresholds, Part B and D premiums carry an extra step-function charge (IRMAA). Defaults to the 2025 single-filer tiers, inflated per path. Real IRMAA keys off your MAGI from two years prior; the model uses the current year as a simplification, so a conversion spike shows its surcharge the same year (ASSUMPTIONS #27).",
  stressTest:
    "What if your wages stopped for a few years — a layoff, a sabbatical, or your role being automated away? Re-runs the plan with salary zeroed for the chosen window (on the same market paths, so the change is pure income effect, not noise) and reports the hit to your success rate. Note: a shock early in your career, when savings are thin, can fail outright — the model counts any year you can't cover essential spending as a failure, so this doubles as an emergency-fund check, not just a retirement-timing one.",
  lifetimeTax:
    "The median total of every dollar of tax (federal + state + FICA + penalties) you pay across the whole plan, in today's dollars, and as a share of lifetime spending. This is the scoreboard for all the tax machinery — the ladder, withdrawal ordering, conversion targets. Lower is better, but only down to the point where chasing it starts shrinking lifestyle. Differences below ~1% are within the model's precision floor (flat state rate, no AMT/NIIT) — don't optimize past it.",
  effLifetimeTax:
    "The share of all the income you earn over your life that goes to income tax — total tax (federal + state + FICA + penalties) ÷ total gross income, on the median path. Far below your marginal rate; the honest 'how much of everything went to tax' number, and a fairer cross-plan comparison than the raw dollar total when incomes differ.",
  ladderSavings:
    "What the Roth conversion ladder, as configured, saves you in lifetime tax versus doing NO conversions at all — both run on the same market paths so the difference is pure strategy. Positive means the ladder pays off: convert cheaply in low-bracket bridge years instead of facing higher-taxed RMDs later. The single-number scoreboard for the whole ladder.",
  marginalCurve:
    "The marginal federal + state rate the NEXT dollar of ordinary income (a Roth conversion, an extra withdrawal) would face, on the median path, year by year. Low-rate years are cheap to convert or realize income in; spikes are the Social Security 'torpedo' and RMDs stacking up. The reference lines mark the headline bracket rates. The torpedo worsens over time because the Social Security taxation thresholds are NOT inflation-indexed by law — so a real-dollar chart understates how much harder late conversions get.",
  spendingTrajectory:
    "Your planned spending over time on the median path (today's dollars) — the sum of every active expense stream plus loan payments. Watch streams switch on and off at their start/end ages, and the drop (or jump) at retirement. This is the demand the portfolio has to fund; pair it with the projection fan to see coverage.",
  healthcareTrajectory:
    "Net health-insurance cost per year after the ACA subsidy (pre-65) and the IRMAA surcharge (65+), with the subsidy shown alongside, on the median path in today's dollars. Because the subsidy shrinks as MAGI rises, a big Roth-conversion year shows up here as a cost spike — the collision the Taxes tab's ladder controls let you manage.",
  ssTimeline:
    "Your Social Security benefit per year on the median path (today's dollars), starting at your claiming age. Move the claiming-age and haircut inputs above and watch the dollars respond. Shown in today's dollars; remember the taxation thresholds that decide the 'torpedo' are nominal and frozen, so the real benefit's tax bite creeps up over time.",
  survival:
    "The share of Monte Carlo paths still funding spending by each age — the success rate as a function of time, not a single number. '95% funded at 80 but 78% at 90' tells you where the danger concentrates: late-life shortfalls may be survivable by trimming, early ones are the real hazard.",
  spendingDepth:
    "On the median path, how far guardrails flexed discretionary spending below (or above) plan each year, as a percentage of planned discretionary. A shallow, brief dip is a livable adjustment; a deep, chronic one is years of quiet belt-tightening the success rate alone hides. The floor and cap lines are your guardrail bounds (a cap above 100% means you've allowed spending the surplus).",
  realizedReturn:
    "The percentile fan of your portfolio's REAL annual return over time. Useful beside the sequence-of-returns scatter: it shows the spread of year-to-year returns you're exposed to, and motivates levers like a rising-equity glidepath or a cash bucket to ride out the bad early years.",
  inflationFan:
    "The cumulative price level relative to today across the Monte Carlo paths — e.g. '2×' means prices have doubled. Inflation is a dominant long-horizon risk this model takes seriously (it clusters, like the 1970s), and because some tax thresholds are frozen in nominal terms, a high-inflation path quietly raises your real tax burden. 'Real' views elsewhere hide this dispersion; here it's explicit.",
  headroom:
    "The median net worth left at the end of the plan, in today's dollars. With no bequest goal and a fixed horizon, this isn't a target to grow — it's unconsumed margin. A large number means you could likely have retired earlier or spent more (see Years To Retirement and Max Sustainable Spending); it is NOT a failure, just headroom you're currently leaving on the table.",
  failureSeverity:
    "Among only the paths that run short, how bad the shortfall is: the median total unmet spending (today's dollars) and how many years it lasts. A binary success rate treats a $500 miss at 89 and a decade-long collapse identically — this separates the survivable trims from the catastrophes.",
  bridgeDrawRate:
    "The share of your penalty-free ACCESSIBLE money you draw each year during the bridge — retirement to 59½, before the locked retirement accounts open — averaged across those years (each year capped at 100%). The bridge is the riskiest stretch: it's funded entirely from the slice of wealth you can actually reach, with no wages and no Social Security yet. A high rate means the liquid runway is working hard and a bad sequence could exhaust it before the accounts unlock; a low rate is comfortable headroom. We cap each year at 100% so the final year — when the bridge fund is intentionally drained toward zero right before the accounts unlock — can't blow up the average. Reads the median path.",
  accountFlows:
    "One signed view of money moving through your accounts on the median path, today's dollars. Bars above zero are contributions (where each surplus dollar is saved); bars below zero are withdrawals (what's drawn from each account, in your Withdrawal-Policy order). Work income and Social Security ride as context lines. It replaces the separate contributions and funding-sources charts so the picture stays meaningful after retirement, when saving stops and drawing begins. The bars are per-year medians by destination/source — they're deliberately NOT differenced into a 'net' or 'deficit', because medians aren't additive (median spending ≠ the sum of median draws); the honest per-path shortfall story lives on the Freedom tab.",
  oneMoreYear:
    "The classic early-retiree question, quantified: how much does working one more year raise your success probability? Read straight off the retirement-age success curve — the gain from retiring at your planned age + 1 instead of your planned age. Diminishing returns up high are the signal you've hit 'enough'; a steep jump means you're retiring into a fragile zone.",
  spendingStrategy:
    "How much you spend each retirement year — distinct from the Withdrawal Policy, which only picks which account to tap. Constant Dollar funds your plan's streams (optionally flexed by guardrails). The portfolio-percentage options instead set discretionary spending from your current balance, so it self-corrects with the market and never depletes to zero — at the cost of a variable income: Constant % takes a fixed share each year; VPW raises that share with age (an annuity payout factor) to deliberately draw the balance down by your horizon; Floor & Ceiling bounds the percentage between a floor and ceiling of your planned discretionary spending. In every percentage mode, essentials (medical + loan payments) are funded first, and a path still fails if the portfolio can't cover them.",
  taxRegime:
    "Your whole low-bracket Roth-ladder strategy is a multi-decade bet that today's tax law holds. This re-runs the plan as if it reverts at the chosen age — ordinary brackets scaled up ~15% and the standard deduction roughly halved (a documented stand-in for a TCJA-style sunset, not an exact pre-2018 table) — on the same market paths, and reports the hit to success and the rise in lifetime tax. The conversion ladder keeps filling to the same taxable-income ceiling; it just gets taxed harder. The biggest decades-scale risk the rest of the app can't see.",
  bridgeConfidence:
    "How confidently you can fund the years from early retirement to 59½ on penalty-free money alone. The headline success rate blends the bridge with longevity risk and counts a path that survives only by paying 10% early-withdrawal penalties as a 'success' — these metrics isolate the bridge so that fragility can't hide.",
  bridgeBreak:
    "Share of Monte Carlo paths where penalty-free money proved insufficient before 60 — by EITHER symptom: a year spending couldn't be met, or a forced last-resort traditional withdrawal that paid the 10% penalty. It splits the overall failures into bridge (early-liquidity) vs longevity (late-life) so you can see which problem you actually have. Most early-retirement plans that fail, fail here.",
  bridgeHolds:
    "Share of Monte Carlo paths whose penalty-free money LASTS to 59½ — no year went unfunded and no forced early-withdrawal penalty was needed (it's 1 − the break rate). This is the full dynamic simulation, so it DOES credit the Roth ladder maturing mid-bridge, market growth, and Social Security. It's the one bridge number to trust; the three to its right are conservative day-one snapshots that ignore the ladder.",
  bridgeFunding:
    "The concrete liquidity target. A conversion you start at retirement doesn't season (become penalty-free) for 5 years, so you must fund the first ~5 retirement years entirely from already-liquid sources. This is the total real spending need over that window and what the simulation draws from cash, taxable, and Roth contributions to meet it — the 'exactly how much liquid do I need' answer the coverage ratio only gestures at.",
  bridgeCoverage:
    "Conservative bridge runway: penalty-free assets the moment you retire, divided by the spending the bridge demands — IGNORING any market growth along the way, so it's a floor, not a forecast. Coverage ≥ 1 means you could reach 60 even if markets went nowhere; the worst-5% (p5) value below 1 means bad sequences force you to lean on growth or on penalized withdrawals. Runway restates it as years of spending covered. NOTE: it's a day-one snapshot and does NOT credit Roth conversions that mature mid-bridge, so for a ladder-reliant plan it understates your real runway — trust Bridge Holds for the verdict.",
  bridgePenalty:
    "How often, and how much, the plan leans on the 10% last-resort early withdrawal from traditional accounts before 59½ (enabled by the 'Last Resort' toggle in Withdrawal Policy). A path can clear the success bar while quietly bleeding penalties for years — pure deadweight loss this surfaces. The dollar figure is the median total penalty, in today's dollars, among paths that pay any.",
  bridgeFan:
    "The spread of total penalty-free assets across all paths, in today's dollars — not just the median. The companion median stack shows what your money is made of; this shows the dispersion. Watch the worst-10% line: if it dives toward zero before the 59½ marker, the bridge runs dry in bad markets even when the median looks comfortable.",
  bridgeMinAccessible:
    "For each path, the lowest your penalty-free balance ever falls during the bridge. The mass near (or at) zero is the set of futures where you nearly — or actually — run out of reachable money before 59½. A thick left tail means the bridge is the fragile part of the plan.",
  bridgeSplit:
    "How your portfolio splits, the moment you retire, into money you can reach penalty-free before 59½ (cash, brokerage, Roth contributions, matured conversions) versus money locked behind the 10% penalty (traditional and Roth earnings, plus the HSA until 65). A low accessible share is the structural root of the bridge problem — total net worth can look fine while too little of it is actually spendable early. NOTE: this is a snapshot the moment you retire; the Roth ladder progressively unlocks the 'locked' traditional balance during the bridge, which this split doesn't show, so for a laddering plan it overstates the problem.",
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
  glidepath:
    "The dotted line traces a straight drawdown from your median net worth at retirement to zero at your horizon — the spend-it-all path. If the median fan floats well above it, that persistent gap is the estate you're accumulating but not consuming. The goal of die-with-zero isn't to land exactly on the line (that risks running out), but to not float far above it for decades. Shown in today's dollars only.",
  fulfillment:
    "Bill Perkins' core idea: a dollar buys more living at 60 than at 88, because health and energy fade. The orange line re-weights your planned spending by an enjoyment factor — full through the go-go years (to 75), tapering to ~30% by 90 — so where it droops far below planned spending, you're funding years you can't fully enjoy. Flat or back-loaded spending is the warning sign; front-loaded (more travel/experiences early) is the die-with-zero ideal. The enjoyment curve is an assumption you can tune, not a fact.",
  tradOverfunding:
    "Whether you've locked too much in pre-tax accounts. From 75 the IRS forces a minimum withdrawal (RMD) whether you need it or not; where the gold RMD line rises above your spending, the red 'forced surplus' is ordinary income you must realize and pay tax on with nowhere to spend it — it just lands back in your taxable estate. A large or growing surplus means convert more during the low-bracket bridge years (Roth Conversion Ladder above) so less is trapped behind RMDs. Median path, today's dollars.",
};
