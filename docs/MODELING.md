# The Modeling — what makes this more than a spreadsheet

This document explains the financial reasoning behind the engine: the effects it
models, *why they matter for an early-retirement decision*, and how it handles
the interactions a simpler tool gets wrong. For the exhaustive list of every
simplifying assumption (and its caveats), see
[ASSUMPTIONS.md](ASSUMPTIONS.md). For the code architecture, see
[DESIGN.md](DESIGN.md).

The thesis throughout: **the hard parts of retirement planning are the
interactions.** Taxes depend on withdrawals, withdrawals depend on spending,
spending can flex with the market, conversions change your MAGI which changes
your ACA subsidy and your Social Security taxation — and all of it compounds
across decades of uncertain returns. Modeling each piece in isolation gives a
confident wrong answer.

---

## Sequence-of-returns risk, and why Monte Carlo

A 7%-a-year spreadsheet says a 4% withdrawal rate lasts forever. Reality doesn't
compound smoothly: a retiree who hits a bad decade *early* can run out even if
the long-run average is fine, because they're selling depressed assets to eat.
This is **sequence-of-returns risk**, and it's the single biggest threat to an
early retiree with a long horizon.

The engine runs thousands of paths and reports the **distribution** of outcomes —
success probability, age-at-ruin, shortfall depth, ending-balance percentiles —
not a point estimate. Two market models:

- **Historical bootstrap (default).** Resamples joint annual rows of (stock,
  bond, inflation) from Shiller's 1871–2022 data in ~5-year blocks. Block
  resampling preserves the *correlation regimes* that matter — e.g. 2022, when
  stocks and bonds fell together and inflation spiked — which independent random
  draws destroy.
- **Parametric.** IID lognormal real returns with AR(1) inflation, for when you
  want to dial assumptions directly.

Returns are entered as **geometric real CAGRs**, because entering an arithmetic
mean (≈1–1.5% higher for stocks) silently overstates every outcome.

---

## The annual fixed-point tax solve

Within each simulated year, several quantities are mutually dependent:

- **Taxes** depend on your ordinary income, which includes Roth conversions and
  traditional withdrawals.
- **Withdrawals** depend on your spending need *plus the tax on the withdrawal
  itself* — you have to sell more to cover the tax on what you sold.
- **The taxable share of Social Security** depends on all your other income.
- **ACA subsidies and IRMAA surcharges** depend on your MAGI, which the above
  determine.

You can't compute these in one pass. The engine resolves them with a
**fixed-point iteration**: income → taxes → free cash flow → withdrawals /
contributions → Roth conversions → ACA/IRMAA feedback, repeated until the values
stop changing (it breaks early once converged). This is what lets it capture the
effects below *together* rather than one at a time.

---

## The Social Security tax torpedo

The most under-appreciated tax in retirement, and a flagship example of why
interactions matter.

Social Security benefits aren't simply taxable or tax-free. The taxable share
steps from 0% → 50% → 85% based on **provisional income** (your other income plus
half your benefit), across two thresholds — $25,000 and $34,000 for a single
filer. The trap: **those thresholds are fixed in statute and never indexed for
inflation.** Over a long retirement, ordinary inflation drags an ever-larger
share of your benefit into tax, regardless of strategy — the "tax torpedo."

It also creates a brutal interaction: a Roth conversion or an extra traditional
withdrawal raises your provisional income, which can push *more of your Social
Security* into taxable territory on top of the tax on the withdrawal itself —
a marginal rate well above your nominal bracket.

The engine implements the full IRS Pub. 915 provisional-income worksheet and
compares against the **nominal, unindexed** thresholds, so the torpedo worsens
realistically over the horizon. A flat "85% of SS is taxable" assumption — common
in spreadsheets — hides exactly the effect that should drive bracket-management
decisions.

---

## LTCG stacking and the standard deduction

Long-term capital gains and qualified dividends are taxed in their own 0/15/20%
brackets, but those brackets **stack on top of your ordinary taxable income** —
the gains fill the LTCG brackets starting from where your ordinary income leaves
off. So the same dollar of conversion can push gains from the 0% LTCG bracket
into the 15% one. The standard deduction applies to ordinary income first, and
any leftover shields gains. The engine models this stacking exactly (with
inflation-scaled brackets), which is what makes the 0%-LTCG-bracket
gain-harvesting opportunity visible — and shows when a conversion would spend it.

---

## The early-retirement bridge

Retiring at 45 means funding ~15 years before penalty-free access at 59½. This is
where most FIRE plans live or die, and the engine treats it as first-class:

- **Penalty-free age rules.** Traditional and Roth *earnings* are penalty-locked
  until 59½ (modeled as the year you turn 60 on the annual grain); HSA
  non-medical withdrawals until 65.
- **The Roth conversion ladder.** Convert traditional → Roth during low-income
  early-retirement years (filling up to a chosen bracket), then withdraw each
  converted amount **after a five-year seasoning period**, penalty-free. The
  engine tracks each conversion's seasoning cohort.
- **The taxable bridge.** Brokerage and cash fund the gap until the first ladder
  rungs season. The **bridge funding plan** quantifies how big a liquid pile you
  need before the ladder turns on.
- **Accessibility, not just net worth.** A path can have plenty of *total* wealth
  and still fail the bridge if it's all locked behind the penalty. The engine
  reports **penalty-free accessible** wealth over time and fails a path the first
  year accessible sources can't meet spending — the failure mode a net-worth-only
  model can't see.

---

## ACA subsidies vs. Roth conversions — a real tension

Before Medicare at 65, an early retiree buys insurance on the ACA marketplace,
where the premium subsidy is a function of **MAGI**. But a Roth conversion *raises*
MAGI — so the same conversion that saves future tax can **shrink this year's ACA
subsidy**. These pull in opposite directions, and the right conversion size
depends on both at once.

The engine models the post-2021 (IRA-extended) subsidy — the expected
contribution rising to a flat 8.5% cap above 400% FPL, no cliff — and folds it
into the annual fixed point, so the subsidy responds to your conversion and
withdrawal decisions. The Accounts tab visualizes the subsidy-vs-conversion
trade directly.

---

## IRMAA, RMDs, and the back half

- **IRMAA** — past 65, Medicare Part B/D premiums jump in steps above MAGI
  thresholds. Modeled as a step-function surcharge, it's another reason a big
  one-year conversion can backfire.
- **RMDs at 75** — required minimum distributions (SECURE 2.0) force taxable
  income out of traditional accounts late in life via the Uniform Lifetime
  Table. Under-converting early means RMDs later push you into higher brackets
  (and more SS taxation, and IRMAA) — the engine's lifetime-tax and
  over-funding views make that visible.
- **Bracket-filled decumulation** — an optional tax-aware withdrawal mode caps
  each year's traditional draw so ordinary income tops out at a chosen bracket,
  spilling the rest to Roth, instead of blindly draining traditional first.

---

## Social Security, estimated from your actual earnings

The figure on your ssa.gov statement assumes you keep working until you claim.
**An early retiree won't** — and the zero-earning years between retirement and
claiming pull the benefit down. The engine can derive your benefit from the
plan's own earnings record: average your 35 highest covered-wage years (capped at
the taxable maximum), apply the 90/32/15 bend-point formula to get your PIA, then
the claiming-age factor. This is the correction that turns an optimistic
statement figure into the benefit you'd actually receive.

---

## Spending behavior: guardrails, VPW, and flexibility

Real retirees don't spend a rigid inflation-adjusted amount through a crash — they
cut back. Modeling spending as perfectly rigid makes failure rates pessimistic.
The engine offers:

- **Guyton-Klinger guardrails** — flex discretionary spending up/down when the
  withdrawal rate drifts outside a band, with floors and caps. Typically adds
  5–15 percentage points of success at marginal withdrawal rates — *if you
  actually execute the cuts*.
- **Percent-of-portfolio / VPW** — spend a percentage of wealth (fixed, or rising
  with age via an annuity factor that draws the balance to zero by the horizon),
  taken on **accessible** wealth so an early retiree's rule doesn't budget off
  penalty-locked balances.

---

## Stress tests and die-with-zero

Beyond the base projection, the engine re-runs the plan under named shocks on the
same market paths, so the comparison is apples-to-apples:

- **Income shock** — wages zeroed for a window (layoff, sabbatical).
- **Retire-into-a-crash** — a market drop right at retirement, the worst-case
  sequence risk.
- **TCJA sunset** — today's tax law reverting to higher rates and a smaller
  standard deduction at a chosen age: the largest decades-scale policy risk to a
  low-bracket ladder strategy, otherwise invisible because every other view
  assumes 2026 law holds forever.

And for those without a bequest motive, a **die-with-zero** estate view and a
**maximum sustainable spending** solver answer the inverse question: not "will I
run out?" but "how much am I leaving on the table?"

---

*Every effect above has a corresponding entry in
[ASSUMPTIONS.md](ASSUMPTIONS.md) documenting its precise boundary and what to
keep in mind when acting on it.*
