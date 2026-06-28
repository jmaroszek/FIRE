"""The simulation engine: one vectorized annual loop over all Monte Carlo paths.

Order of operations within each simulated year (documented in docs/DESIGN.md):
  1. resolve the active regime (salary, match, allocation) from events
  2. RMD (age >= 75) is forced out of traditional accounts first
  3. HSA pays its share of medical expenses
  4. fixed-point iteration (taxes <-> contributions <-> withdrawals <-> conversions):
       income -> FICA/federal/state tax -> free cash flow ->
       positive: contribution waterfall / negative: withdrawal policy ->
       Roth conversions to the bracket target -> repeat
  5. apply the converged plan (contributions, withdrawals, conversions, events)
  6. end-of-year growth at the allocation-blended return; record state

All user inputs are in today's (start-year) dollars; brackets, limits, and
flows scale with each path's simulated cumulative inflation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

from . import taxes as taxmod
from .accounts import (
    PortfolioState,
    apply_plan,
    plan_withdrawals,
)
from .constants import (
    HSA_PENALTY_FREE_AGE,
    LADDER_DEFAULT_END_AGE,
    PENALTY_FREE_AGE,
    RMD_START_AGE,
)
from .sampling import MarketPaths, sample_paths
from .social_security import estimate_pia
from .scenario import (
    AccountType,
    Allocation,
    EventKind,
    ExpenseStream,
    ROTH_TYPES,
    SS_CLAIMING_FACTORS,
    Scenario,
    TaxRegimeShock,
    WaterfallStep,
    WithdrawalSource,
    validate_invariants,
)

DATA_DIR = Path(__file__).parent / "data"
FIXED_POINT_ITERATIONS = 6

_limits_cache: dict | None = None
_rmd_cache: dict[int, float] | None = None


def load_limits() -> dict:
    global _limits_cache
    if _limits_cache is None:
        _limits_cache = json.loads((DATA_DIR / "limits.json").read_text())["limits"]
    return _limits_cache


def load_rmd_divisors() -> dict[int, float]:
    global _rmd_cache
    if _rmd_cache is None:
        raw = json.loads((DATA_DIR / "rmd_table.json").read_text())["divisors"]
        _rmd_cache = {int(k): v for k, v in raw.items()}
    return _rmd_cache


@dataclass
class YearRegime:
    salary_real: float
    match_pct: float
    weights: tuple[float, float, float]  # stocks, bonds, cash
    bonus_real: float = 0.0  # annual bonus (today's $), zeroed once retired


def _liability_schedule(scenario: Scenario, T: int) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic nominal amortization of all liabilities.

    Returns (payments (T,), outstanding balance (T+1,)). Loans are nominal
    contracts: payments are fixed dollars, identical across paths.
    """
    payments = np.zeros(T)
    balance = np.zeros(T + 1)
    start_age = scenario.start_age
    for liab in scenario.liabilities:
        # future loans begin amortizing at start_age; present-day debt at t=0
        t_start = max(liab.start_age - start_age, 0) if liab.start_age is not None else 0
        if t_start > T:
            continue
        bal = max(liab.balance, 0.0)
        balance[t_start] += bal
        for t in range(t_start, T):
            if bal <= 1e-9:
                break
            bal *= 1.0 + liab.interest_rate
            pay = min(liab.annual_payment, bal)
            payments[t] += pay
            bal -= pay
            balance[t + 1] += bal
    return payments, balance


def _annual_payment(principal: float, rate: float, n_years: int) -> float:
    """Level annual mortgage payment that amortizes `principal` over `n_years`."""
    if principal <= 0.0 or n_years <= 0:
        return 0.0
    if rate <= 1e-12:
        return principal / n_years
    return principal * rate / (1.0 - (1.0 + rate) ** (-n_years))


@dataclass
class HousingSchedule:
    """Deterministic home lifecycle: a nominal contract like a liability.

    All arrays are off the mean-inflation path (identical across paths). Effects
    are timed so the home asset, the mortgage balance, and the down-payment cash
    outflow all land at the SAME net-worth boundary — no spurious step at purchase.
    The down payment is a forced withdrawal in year `purchase_t` (it lands at the
    next boundary, where the home and mortgage first appear); ownership costs and
    payments begin the following year. See the frontend `xValues` for why the
    home appears at boundary `purchase_t + 1` (plotted at the purchase age).
    """

    home_value: np.ndarray         # (T+1,) nominal; 0 when not owned
    mortgage_balance: np.ndarray   # (T+1,) nominal; 0 when not owned
    payment: np.ndarray            # (T,) nominal P&I each year (rides liab_payments)
    interest: np.ndarray           # (T,) nominal interest portion (for itemization)
    property_tax: np.ndarray       # (T,) nominal property tax (deterministic; itemization)
    down_outflow: float            # nominal cash out at purchase (down + closing + points)
    purchase_t: int                # sim-year index of the down-payment outflow
    down_account: AccountType | None  # None = drawn via the withdrawal policy
    sale_t: int | None             # sim-year index of the sale windfall, or None
    sale_proceeds: float           # nominal net proceeds deposited at sale
    sale_account: AccountType


def _housing_schedule(scenario: Scenario, T: int) -> "HousingSchedule | None":
    """Derive the whole home from `scenario.housing` (None when disabled).

    Sizes the nominal mortgage from the today's-$ inputs off the mean-inflation
    path, so the inputs and the loan can never drift; amortizes annually (fixed
    or a single ARM reset); and, for a sale, computes net proceeds after payoff,
    selling costs, and the gain above the §121 primary-residence exclusion.
    """
    h = scenario.housing
    if not h.enabled:
        return None
    start_age = scenario.start_age
    pt = max(h.purchase_age - start_age, 0)       # down-payment year
    if pt >= T:
        return None                               # purchase at/after the horizon
    own0 = pt + 1                                  # boundary ownership begins (purchase age)

    mean = scenario.inflation.mean
    g = (1.0 + mean) * (1.0 + h.appreciation_real) - 1.0  # nominal home appreciation

    # optional sale: proceeds land at boundary sale_t+1; held through boundary sale_t
    sale_t: int | None = None
    if h.sale_age is not None:
        s = h.sale_age - start_age
        if own0 <= s <= T:
            sale_t = s
    last = sale_t if sale_t is not None else T     # last boundary the home is held

    home_value = np.zeros(T + 1)
    mortgage_balance = np.zeros(T + 1)
    payment = np.zeros(T)
    interest = np.zeros(T)
    property_tax = np.zeros(T)

    # nominal price = the home's value at the purchase age (boundary own0)
    price = h.home_price * (1.0 + g) ** pt
    loan0 = (1.0 - h.down_payment_pct) * price
    down_outflow = (h.down_payment_pct + h.closing_costs_pct) * price + h.points * loan0

    for t in range(own0, last + 1):
        home_value[t] = price * (1.0 + g) ** (t - own0)

    # annual amortization; loan originates at boundary own0, first payment year own0
    bal = loan0
    rate = h.mortgage_rate
    pay = _annual_payment(loan0, rate, h.loan_term_years)
    for t in range(own0, last + 1):
        mortgage_balance[t] = bal
        if t >= T:
            break                                  # boundary T has no year to process
        if sale_t is not None and t == sale_t:
            break                                  # sale year: paid off via proceeds, no carry
        if h.loan_type == "arm" and (t - own0) == h.arm_fixed_years and bal > 1e-9:
            rate = h.arm_reset_rate
            pay = _annual_payment(bal, rate, max(h.loan_term_years - h.arm_fixed_years, 1))
        if bal > 1e-9:
            intr = bal * rate
            principal = min(pay - intr, bal)
            interest[t] = intr
            payment[t] = intr + principal
            bal = bal - principal
        property_tax[t] = h.property_tax_rate * home_value[t]  # year-t deductible (itemization)

    sale_proceeds = 0.0
    if sale_t is not None:
        value = home_value[sale_t]
        payoff = mortgage_balance[sale_t]
        costs = h.selling_costs_pct * value
        gain = max(value - price - costs, 0.0)
        exclusion = h.cap_gains_exclusion * (1.0 + mean) ** sale_t
        cap_tax = h.cap_gains_rate * max(gain - exclusion, 0.0)
        sale_proceeds = max(value - payoff - costs - cap_tax, 0.0)

    return HousingSchedule(
        home_value=home_value, mortgage_balance=mortgage_balance, payment=payment,
        interest=interest, property_tax=property_tax, down_outflow=down_outflow,
        purchase_t=pt, down_account=h.down_payment_account, sale_t=sale_t,
        sale_proceeds=sale_proceeds, sale_account=h.sale_proceeds_account,
    )


def _expand_housing_streams(scenario: Scenario) -> Scenario:
    """A copy of `scenario` with the home's carrying costs appended as essential
    expense streams (no-op when housing is disabled). Property tax and maintenance
    scale with the home's real appreciation; insurance is flat real. Costs run from
    the year after purchase (when payments begin) through the last owned year.
    """
    h = scenario.housing
    if not h.enabled:
        return scenario
    start_age = scenario.start_age
    pt = max(h.purchase_age - start_age, 0)
    own_age = start_age + pt + 1                    # carrying costs begin with payments
    last_age = (h.sale_age - 1 if h.sale_age is not None and h.sale_age - start_age > pt + 1
                else scenario.profile.horizon_age)
    if own_age > last_age:
        return scenario
    extra = h.appreciation_real                     # carrying costs track real appreciation
    new = [
        ExpenseStream(name="Property Tax", annual=h.property_tax_rate * h.home_price,
                      start_age=own_age, end_age=last_age, extra_inflation=extra,
                      essential=True),
        ExpenseStream(name="Home Insurance", annual=h.insurance_annual,
                      start_age=own_age, end_age=last_age, essential=True),
        ExpenseStream(name="Home Maintenance", annual=h.maintenance_pct * h.home_price,
                      start_age=own_age, end_age=last_age, extra_inflation=extra,
                      essential=True),
    ]
    # PMI: a flat nominal cost when the down payment is under 20%, ending once the
    # loan amortizes to 78% of the original value (HPA auto-termination). The cutoff
    # is timed off the initial rate — a documented approximation for ARMs.
    if h.down_payment_pct < 0.20 and h.pmi_rate > 0:
        mean = scenario.inflation.mean
        g = (1.0 + mean) * (1.0 + h.appreciation_real) - 1.0
        price = h.home_price * (1.0 + g) ** pt
        loan0 = (1.0 - h.down_payment_pct) * price
        pay = _annual_payment(loan0, h.mortgage_rate, h.loan_term_years)
        bal, yrs = loan0, 0
        while bal > 0.78 * price and yrs < h.loan_term_years:
            bal = bal * (1.0 + h.mortgage_rate) - min(pay, bal * (1.0 + h.mortgage_rate))
            yrs += 1
        pmi_end = min(own_age + max(yrs - 1, 0), last_age)
        new.append(ExpenseStream(name="PMI", annual=h.pmi_rate * loan0, start_age=own_age,
                                 end_age=pmi_end, inflates=False, essential=True))
    return scenario.model_copy(update={"expense_streams": list(scenario.expense_streams) + new})


@dataclass
class SimResult:
    scenario: Scenario
    ages: np.ndarray  # (T,) age during each sim year
    years: np.ndarray  # (T,) calendar years
    cum_inflation: np.ndarray  # (P, T+1)
    net_worth: np.ndarray  # (P, T+1) nominal, [:,0] = initial
    pools: dict[str, np.ndarray]  # name -> (P, T+1) nominal
    fail: np.ndarray  # (P, T) bool
    taxes_paid: np.ndarray  # (P, T) nominal
    spending_mult: np.ndarray  # (P, T) guardrail multiplier on discretionary spend
    conversions: np.ndarray  # (P, T) nominal Roth conversions
    accessible: dict[str, np.ndarray]  # source -> (P, T) nominal, end of year
    ss_income: np.ndarray  # (P, T) nominal
    expenses: np.ndarray  # (P, T) nominal total expenses
    contributions: np.ndarray  # (P, T) nominal total contributions
    contrib_pools: dict[str, np.ndarray] | None = None  # destination -> (P, T) nominal
    liability_balance: np.ndarray | None = None  # (T+1,) nominal outstanding debt
    # Housing overlay (deterministic, off the mean-inflation path; None when housing
    # is disabled). The home is an asset reported alongside net worth but kept OUT
    # of the spendable pool. home_mortgage_balance is already inside liability_balance.
    home_value: np.ndarray | None = None  # (T+1,) nominal home value
    home_mortgage_balance: np.ndarray | None = None  # (T+1,) nominal outstanding mortgage
    conversion_marginal_rate: np.ndarray | None = None  # (P, T) marginal tax on next conversion $
    conversion_tax: np.ndarray | None = None  # (P, T) nominal tax attributable to the year's Roth
    # conversion (year's income tax minus its no-conversion counterfactual) — the added tax the
    # conversion creates, separate from tax owed anyway. Lets the ladder show a clean self-fund line.
    effective_rate: np.ndarray | None = None  # (P, T) avg fed+state income tax / taxable income
    # (the much-lower companion to the marginal rate — what you actually pay on average)
    rmds: np.ndarray | None = None  # (P, T) nominal required minimum distributions
    port_return: np.ndarray | None = None  # (P, T) nominal blended portfolio return that year
    # (allocation-weighted stock/bond/cash). Deflate with cum_inflation for real returns.
    aca_subsidy: np.ndarray | None = None  # (P, T) nominal ACA premium subsidy received
    net_health_cost: np.ndarray | None = None  # (P, T) nominal net ACA premium + IRMAA surcharge
    shortfall: np.ndarray | None = None  # (P, T) nominal unfunded spending need each year
    # (>1.0 is what trips `fail`); deflate with cum_inflation to size depth-of-ruin.
    withdrawals: dict[str, np.ndarray] | None = None  # source -> (P, T) nominal amount drawn
    penalty_paid: np.ndarray | None = None  # (P, T) nominal 10% early-withdrawal penalty paid
    # (trad tapped before the penalty-free age). Relying on this is now itself a
    # failure (see the fail predicate below), so it no longer hides inside "success".
    spending_need: np.ndarray | None = None  # (P, T) nominal gross withdrawal need each year
    # (the negative cash flow withdrawals must cover, taxes included) — sizes the bridge demand.
    gross_income: np.ndarray | None = None  # (P, T) nominal gross income (effective-rate denominator)
    wages: np.ndarray | None = None  # (P, T) nominal active work income (salary + secondary streams)
    legacy_met: np.ndarray | None = None  # (P,) bool: ended with >= the legacy floor (real)
    # PIA (monthly benefit at FRA, today's $) estimated from the plan's covered
    # earnings — what the UI shows for the "estimate from my income" mode.
    ss_estimated_monthly_at_fra: float = 0.0

    @property
    def success_rate(self) -> float:
        # A path succeeds if it never ran short mid-stream AND left at least the
        # legacy floor (legacy_met is all-True when legacy_target is 0, so this
        # reduces to the original definition).
        failed = self.fail.any(axis=1)
        if self.legacy_met is not None:
            failed = failed | ~self.legacy_met
        return float(1.0 - failed.mean())


def _precompute_regimes(scenario: Scenario, retirement_age: int) -> list[YearRegime]:
    T = scenario.n_years
    start_age = scenario.start_age
    regime_events: dict[int, list] = {}
    for ev in scenario.events:
        if ev.kind is EventKind.regime_change and ev.overrides is not None:
            t = scenario.event_year_index(ev)
            if 0 <= t < T:
                regime_events.setdefault(t, []).append(ev.overrides)

    out: list[YearRegime] = []
    mean_infl = scenario.inflation.mean

    def to_real(g: float) -> float:
        # growth inputs are nominal by default; convert at expected inflation
        if scenario.income.growth_mode == "nominal":
            return (1 + g) / (1 + mean_infl) - 1
        return g

    salary = scenario.income.gross_salary
    bonus = scenario.income.bonus
    growth = scenario.income.effective_real_growth(mean_infl)
    match = scenario.income.employer_match_pct
    alloc = scenario.allocation
    # Age-based allocation glidepath: the base allocation re-asserts to each
    # segment's mix from its start_age onward. Empty (the default) -> the static
    # `alloc` for every year, identical to pre-glide behavior. Explicit
    # allocation regime-events still override within their year (applied below).
    alloc_segs = sorted(scenario.allocation_schedule, key=lambda s: s.start_age)
    seg_idx = 0
    segment_start = 0
    salary_set_at = -1  # sim-year when salary was last explicitly set

    for t in range(T):
        age = start_age + t
        while seg_idx < len(alloc_segs) and alloc_segs[seg_idx].start_age <= age:
            alloc = alloc_segs[seg_idx].allocation
            seg_idx += 1
        if t in regime_events:
            # salary compounds up to the event, then the overrides take effect.
            # the bonus rides the same raise, compounding up to the event too.
            salary = salary * (1 + growth) ** (t - segment_start)
            bonus = bonus * (1 + growth) ** (t - segment_start)
            segment_start = t
            for ov in regime_events[t]:
                if ov.gross_salary is not None:
                    salary = ov.gross_salary
                    salary_set_at = t
                if ov.salary_real_growth is not None:
                    growth = to_real(ov.salary_real_growth)
                if ov.employer_match_pct is not None:
                    match = ov.employer_match_pct
                if ov.allocation is not None:
                    alloc = ov.allocation
        salary_t = salary * (1 + growth) ** (t - segment_start)
        bonus_t = bonus * (1 + growth) ** (t - segment_start)
        retired = age >= retirement_age
        # retirement zeroes the salary unless a regime event at/after the
        # retirement year explicitly set one (e.g. barista FIRE)
        if retired and salary_set_at < retirement_age - start_age:
            salary_t = 0.0
        # the bonus is working-years compensation: it always stops at retirement
        # (barista-FIRE income is modeled through the salary override, not here).
        if retired:
            bonus_t = 0.0
        out.append(YearRegime(salary_real=salary_t, bonus_real=bonus_t, match_pct=match,
                              weights=(alloc.stocks, alloc.bonds, alloc.cash)))
    return out


def _expenses_for_year(scenario: Scenario, t: int, age: int,
                       cum_infl: np.ndarray) -> tuple[np.ndarray, ...]:
    """(essential, discretionary, essential_medical, discretionary_medical),
    each (P,) nominal. Discretionary streams are subject to guardrail cuts.

    General expense_streams may still flag is_medical (deprecated fallback);
    dedicated medical_streams are always essential medical and HSA-eligible."""
    ess = np.zeros_like(cum_infl)
    disc = np.zeros_like(cum_infl)
    ess_med = np.zeros_like(cum_infl)
    disc_med = np.zeros_like(cum_infl)
    for s in scenario.expense_streams:
        if s.start_age is not None and age < s.start_age:
            continue
        if s.end_age is not None and age > s.end_age:
            continue
        amount = s.annual * (1 + s.extra_inflation) ** t
        nominal = amount * cum_infl if s.inflates else np.full_like(cum_infl, amount)
        if s.essential:
            ess = ess + nominal
            if s.is_medical:
                ess_med = ess_med + nominal
        else:
            disc = disc + nominal
            if s.is_medical:
                disc_med = disc_med + nominal
    for s in scenario.medical_streams:
        if s.start_age is not None and age < s.start_age:
            continue
        if s.end_age is not None and age > s.end_age:
            continue
        amount = s.annual * (1 + s.extra_inflation) ** t
        nominal = amount * cum_infl if s.inflates else np.full_like(cum_infl, amount)
        ess = ess + nominal
        ess_med = ess_med + nominal
    # Long-term / end-of-life care: an essential, HSA-eligible medical expense
    # over [onset_age, onset_age + duration - 1], healthcare-inflating like the
    # medical streams above.
    ltc = scenario.ltc
    if (ltc.enabled and ltc.annual_cost > 0 and ltc.duration_years > 0
            and ltc.onset_age <= age <= ltc.onset_age + ltc.duration_years - 1):
        amount = ltc.annual_cost * (1 + ltc.extra_inflation) ** t
        nominal = amount * cum_infl
        ess = ess + nominal
        ess_med = ess_med + nominal
    return ess, disc, ess_med, disc_med


def _secondary_income_schedule(scenario: Scenario, mean_infl: float
                               ) -> list[list[tuple[float, float]]]:
    """Per simulation year, the list of (real_value, vol) for each secondary
    income stream active that year. Real values compound from the stream's start
    at its own growth; nominal conversion and per-path volatility are applied in
    the loop. Empty inner lists (the default, no streams) reproduce single-salary
    behavior exactly."""
    T = scenario.n_years
    start_age = scenario.start_age
    by_year: list[list[tuple[float, float]]] = [[] for _ in range(T)]
    for stream in scenario.income_streams:
        g = stream.effective_real_growth(mean_infl)
        s_age = stream.start_age if stream.start_age is not None else start_age
        e_age = stream.end_age if stream.end_age is not None else scenario.profile.horizon_age
        t_start = max(s_age - start_age, 0)
        for t in range(T):
            age = start_age + t
            if s_age <= age <= e_age:
                real_val = stream.annual * (1 + g) ** max(t - t_start, 0)
                by_year[t].append((real_val, stream.vol))
    return by_year


def _waterfall_for_years(scenario: Scenario, T: int) -> list[list[WaterfallStep]]:
    """The active contribution waterfall per simulation year. The base
    `scenario.waterfall` applies until the first scheduled segment's start_age,
    then each segment overrides from its start_age onward. Empty schedule (the
    default) -> the base waterfall every year, unchanged."""
    start_age = scenario.start_age
    segments = sorted(scenario.waterfall_schedule, key=lambda s: s.start_age)
    by_year: list[list[WaterfallStep]] = []
    for t in range(T):
        age = start_age + t
        steps = scenario.waterfall
        for seg in segments:
            if seg.start_age <= age:
                steps = seg.steps
            else:
                break
        by_year.append(steps)
    return by_year


def _contribution_limits(age: int, infl: np.ndarray, coverage: str) -> dict[str, np.ndarray]:
    lim = load_limits()
    k401 = lim["employee_401k"]
    if 60 <= age <= 63:
        k401 += lim["employee_401k_catchup_60_63"]
    elif age >= 50:
        k401 += lim["employee_401k_catchup_50"]
    ira = lim["ira"] + (lim["ira_catchup_50"] if age >= 50 else 0)
    hsa = lim["hsa_self_only"] if coverage == "self_only" else lim["hsa_family"]
    if age >= 55:
        hsa += lim["hsa_catchup_55"]
    return {"401k": k401 * infl, "ira": ira * infl, "hsa": hsa * infl}


_LIMIT_GROUP = {
    AccountType.trad_401k: "401k",
    AccountType.roth_401k: "401k",
    AccountType.trad_ira: "ira",
    AccountType.roth_ira: "ira",
    AccountType.hsa: "hsa",
}
_PRETAX_TYPES = (AccountType.trad_401k, AccountType.trad_ira, AccountType.hsa)


def _allocate_waterfall(
    available: np.ndarray,
    steps: list[WaterfallStep],
    limits: dict[str, np.ndarray],
    match_pct: float,
    wages: np.ndarray,
    infl: np.ndarray,
    match_wages: np.ndarray | None = None,
) -> tuple[dict[AccountType, np.ndarray], np.ndarray, np.ndarray]:
    """Allocate positive free cash flow down the waterfall.

    Returns (contributions by account type, pretax total, employer match).
    Pure function of the inputs; capped by group limits and available cash.
    The employer match is keyed off `match_wages` (the primary salary) so
    secondary income streams don't inflate the match; defaults to `wages`.
    """
    if match_wages is None:
        match_wages = wages
    remaining = np.maximum(available, 0.0).copy()
    group_left = {k: v.copy() for k, v in limits.items()}
    contrib: dict[AccountType, np.ndarray] = {}

    for step in steps:
        group = _LIMIT_GROUP.get(step.account)
        cap = group_left[group] if group else np.full_like(remaining, np.inf)
        if step.kind == "to_match":
            want = np.minimum(match_pct * match_wages, cap)
        elif step.kind == "fixed":
            want = np.minimum((step.amount or 0.0) * infl, cap)
        else:  # max
            want = cap
        take = np.minimum(want, remaining)
        contrib[step.account] = contrib.get(step.account, 0) + take
        if group:
            group_left[group] = cap - take
        remaining -= take

    pretax = sum(
        (v for k, v in contrib.items() if k in _PRETAX_TYPES),
        start=np.zeros_like(remaining),
    )
    employee_401k = sum(
        (v for k, v in contrib.items() if k in (AccountType.trad_401k, AccountType.roth_401k)),
        start=np.zeros_like(remaining),
    )
    match = np.where(employee_401k > 0, match_pct * match_wages, 0.0)
    return contrib, pretax, match


def _aca_applicable_pct(fpl_ratio: np.ndarray) -> np.ndarray:
    """Post-2021 (IRA-extended) ACA applicable percentage — the share of MAGI a
    household is expected to pay toward the benchmark plan — by % of the federal
    poverty line. No 400%-FPL cliff: it caps at 8.5%."""
    pct = fpl_ratio * 100.0
    xs = [0.0, 150.0, 200.0, 250.0, 300.0, 400.0, 1e9]
    ys = [0.0, 0.0, 0.02, 0.04, 0.06, 0.085, 0.085]
    return np.interp(pct, xs, ys)


def _irmaa_surcharge(magi: np.ndarray, brackets, infl: np.ndarray) -> np.ndarray:
    """Step-function Medicare surcharge: the highest bracket whose (inflation-
    scaled) threshold MAGI exceeds sets the annual Part B + D surcharge."""
    surcharge = np.zeros_like(magi)
    for b in brackets:  # brackets ascending; last exceeded wins
        surcharge = np.where(magi > b.magi_threshold * infl, b.annual_surcharge * infl, surcharge)
    return surcharge


def run(
    scenario: Scenario,
    paths: MarketPaths | None = None,
    retirement_age: int | None = None,
    balance_scale: float = 1.0,
    spending_scale: float | np.ndarray = 1.0,
    spending_scale_from_age: int | None = None,
    tax_regime: TaxRegimeShock | None = None,
    deterministic: bool = False,
) -> SimResult:
    errors = validate_invariants(scenario)
    if errors:
        raise ValueError("invalid scenario: " + "; ".join(errors))
    tables = taxmod.load_tax_tables()
    # TCJA-sunset / regime-shock tables: same structure, higher ordinary rates
    # and a smaller standard deduction, applied only from the sunset age forward.
    tables_sunset = (
        replace(tables,
                ordinary_rates=tables.ordinary_rates * tax_regime.bracket_rate_mult,
                standard_deduction=tables.standard_deduction * tax_regime.std_deduction_mult)
        if tax_regime is not None else tables
    )
    rmd_divisors = load_rmd_divisors()
    retirement_age = retirement_age if retirement_age is not None else scenario.retirement_age

    if paths is None:
        paths = sample_paths(scenario, deterministic=deterministic)
    P, T = paths.n_paths, paths.n_years
    start_age = scenario.start_age
    state = PortfolioState(scenario, P, balance_scale=balance_scale)
    regimes = _precompute_regimes(scenario, retirement_age)
    # secondary income streams (side hustles, rental, barista) layered on the
    # primary salary; empty list -> single-salary behavior, unchanged.
    secondary_income = _secondary_income_schedule(scenario, scenario.inflation.mean)
    income_z = paths.income_z
    # contribution waterfall per year (age-keyed overrides; empty schedule is a no-op)
    waterfall_by_year = _waterfall_for_years(scenario, T)

    # group one-time flow events by sim year; recurring_flow events fan out into
    # one bucket per occurrence (every interval_years through end_age), each
    # behaving like a one_time_flow of the same amount/account.
    onetime: dict[int, list] = {}
    for ev in scenario.events:
        if ev.kind is EventKind.one_time_flow:
            t = scenario.event_year_index(ev)
            if 0 <= t < T:
                onetime.setdefault(t, []).append(ev)
        elif ev.kind is EventKind.recurring_flow:
            interval = max(int(ev.interval_years or 1), 1)
            last_age = ev.end_age if ev.end_age is not None else scenario.profile.horizon_age
            t = scenario.event_year_index(ev)
            while t < T and start_age + t <= last_age:
                if t >= 0:
                    onetime.setdefault(t, []).append(ev)
                t += interval

    conv_rule = scenario.conversion_rule
    conv_start = conv_rule.start_age if conv_rule.start_age is not None else retirement_age
    conv_end = conv_rule.end_age if conv_rule.end_age is not None else LADDER_DEFAULT_END_AGE

    ss = scenario.social_security
    ss_factor = SS_CLAIMING_FACTORS.get(ss.claiming_age, 1.0)
    # Estimate the PIA from the plan's covered-earnings history (counts the
    # post-retirement $0 years an ssa.gov projection omits). Computed always so
    # the UI can show it alongside the manual figure; only *used* in estimated
    # mode. `regimes` already carries the real salary path with any overrides.
    ss_estimated_monthly = estimate_pia(
        scenario, [r.salary_real + r.bonus_real for r in regimes])
    ss_monthly = ss_estimated_monthly if ss.benefit_mode == "estimated" else ss.monthly_at_fra
    ss_annual_real = ss_monthly * 12 * ss_factor * ss.haircut

    policy = scenario.withdrawal_policy
    div_yield = scenario.market.dividend_yield
    expense_ratio = scenario.market.expense_ratio
    aca = scenario.aca
    irmaa = scenario.irmaa

    liab_payments, liab_balance = _liability_schedule(scenario, T)

    # Housing: derive the mortgage (rides the liability channels — payment is an
    # essential expense, balance reduces net worth) and the appreciating home
    # asset (a separate overlay kept OUT of the spendable pool). The down payment
    # (forced outflow) and sale (windfall) are injected in-loop at their years.
    # Carrying-cost streams are expanded onto a working copy; the original scenario
    # is returned in the result so the round-trip stays clean.
    original_scenario = scenario
    housing = _housing_schedule(scenario, T)
    if housing is not None:
        scenario = _expand_housing_streams(scenario)
        liab_payments = liab_payments + housing.payment
        liab_balance = liab_balance + housing.mortgage_balance
    housing_forced: dict[int, tuple] = {}
    housing_windfall: dict[int, tuple] = {}
    if housing is not None:
        if 0 <= housing.purchase_t < T and housing.down_outflow > 0:
            housing_forced[housing.purchase_t] = (housing.down_account, housing.down_outflow)
        if housing.sale_t is not None and 0 <= housing.sale_t < T and housing.sale_proceeds > 0:
            housing_windfall[housing.sale_t] = (housing.sale_account, housing.sale_proceeds)

    # result arrays
    nw = np.zeros((P, T + 1))
    nw[:, 0] = state.total_net_worth() - liab_balance[0]
    pool_names = ("taxable", "trad", "roth", "hsa", "cash")
    pools = {n: np.zeros((P, T + 1)) for n in pool_names}
    for n in pool_names:
        pools[n][:, 0] = getattr(state, n)
    fail = np.zeros((P, T), dtype=bool)
    taxes_paid = np.zeros((P, T))
    spending_mult_out = np.ones((P, T))
    conversions_out = np.zeros((P, T))
    conv_marginal_rate = np.zeros((P, T))
    conv_tax_out = np.zeros((P, T))
    effective_rate_out = np.zeros((P, T))
    rmds_out = np.zeros((P, T))
    contrib_pool_names = ("taxable", "trad", "roth", "hsa", "cash", "match")
    contrib_pools_out = {n: np.zeros((P, T)) for n in contrib_pool_names}
    ss_out = np.zeros((P, T))
    expenses_out = np.zeros((P, T))
    contributions_out = np.zeros((P, T))
    port_return_out = np.zeros((P, T))
    aca_subsidy_out = np.zeros((P, T))
    net_health_cost_out = np.zeros((P, T))  # net ACA premium + IRMAA surcharge
    shortfall_out = np.zeros((P, T))  # nominal unfunded need each year (depth of ruin)
    penalty_out = np.zeros((P, T))  # nominal 10% early-withdrawal penalty paid each year
    need_out = np.zeros((P, T))  # nominal gross withdrawal need each year (bridge demand)
    gross_income_out = np.zeros((P, T))  # nominal gross income (wages, SS, investment, withdrawals)
    wages_out = np.zeros((P, T))  # nominal active (work) income: primary salary + secondary streams
    withdrawals_out: dict[str, np.ndarray] = {}  # source -> (P, T) nominal amount drawn
    accessible_out: dict[str, np.ndarray] = {}

    zeros = np.zeros(P)

    # guardrails: per-path discretionary spending multiplier and the initial
    # withdrawal rate recorded in the retirement year
    guard = scenario.guardrails
    strat = scenario.spending_strategy
    t_retire = max(retirement_age - start_age, 0)
    spend_mult = np.ones(P)
    w0: np.ndarray | None = None
    prev_disc_real: np.ndarray | None = None  # last year's realized discretionary (real $), for smoothing

    for t in range(T):
        age = start_age + t
        regime = regimes[t]
        infl = paths.cum_inflation[:, t]
        # post-sunset years pay tax under the reverted regime; pre-sunset under
        # today's law. Only ordinary rates + the standard deduction differ, so
        # using tables_eff for every tax call below is safe.
        tables_eff = tables_sunset if (tax_regime is not None and age >= tax_regime.sunset_age) else tables
        state.season_conversions(t)
        portfolio_start = state.total_net_worth()

        primary_wages = regime.salary_real * infl
        # annual bonus on the primary salary line: nominal value with optional
        # per-path lognormal noise (mean-1, expected bonus unchanged). Counts as
        # wages (FICA/SS/contribution headroom) but is kept out of the match base.
        if regime.bonus_real > 0.0:
            bvol = scenario.income.bonus_vol
            if bvol > 0.0 and income_z is not None:
                bmult = np.exp(income_z[:, t] * bvol - 0.5 * bvol * bvol)
            else:
                bmult = 1.0
            bonus_wages = regime.bonus_real * infl * bmult
        else:
            bonus_wages = zeros
        # secondary streams: nominal value with optional per-path lognormal noise
        # (mean-1, so the expected income is unchanged); primary stays predictable.
        secondary_wages = zeros
        for real_val, vol in secondary_income[t]:
            if vol > 0.0 and income_z is not None:
                mult = np.exp(income_z[:, t] * vol - 0.5 * vol * vol)
            else:
                mult = 1.0
            secondary_wages = secondary_wages + real_val * infl * mult
        wages = primary_wages + bonus_wages + secondary_wages
        ss_nom = ss_annual_real * infl if age >= ss.claiming_age else zeros

        # RMD comes out of traditional accounts before anything else
        if age >= RMD_START_AGE:
            divisor = rmd_divisors.get(min(age, max(rmd_divisors)), None)
            rmd = state.trad / divisor if divisor else zeros
            state.trad = state.trad - rmd
        else:
            rmd = zeros

        ess_nom, disc_nom, ess_med, disc_med = _expenses_for_year(scenario, t, age, infl)
        # spending_scale flexes the controllable living-expense lever (used by the
        # max-sustainable-spend solver and the success surface). It leaves medical
        # streams unscaled (essential, ACA/IRMAA-coupled) and loan payments unscaled
        # (contractual), so the HSA medical offset below stays consistent.
        # spending_scale_from_age gates the lever to retirement-and-later years, so
        # the "max sustainable spending IN RETIREMENT" solver flexes only the
        # decumulation budget, not the accumulation-era expenses.
        # spending_scale may be a scalar (the common case) OR a per-path (P,) array:
        # the success surface evaluates several spending levels in ONE run by tiling
        # the path set and passing a per-path scale, which broadcasts cleanly here.
        gate_ok = spending_scale_from_age is None or age >= spending_scale_from_age
        scale_is_vector = isinstance(spending_scale, np.ndarray)
        if gate_ok and (scale_is_vector or spending_scale != 1.0):
            ess_nom = ess_med + (ess_nom - ess_med) * spending_scale
            disc_nom = disc_med + (disc_nom - disc_med) * spending_scale
        ess_nom = ess_nom + liab_payments[t]  # loan payments: essential, non-inflating

        if t >= t_retire and strat.kind == "percent_portfolio":
            # Portfolio-percentage family: discretionary spending is set from the
            # CURRENT balance each year, so it self-corrects with the market and
            # never depletes to zero. Essentials (medical + loan payments, already
            # folded into ess_nom) are funded first; whatever the rule leaves above
            # them becomes the discretionary budget. spend_mult is recomputed fresh
            # each year (no ratchet), unlike the guardrail path.
            #
            # The base is ACCESSIBLE (penalty-free) wealth, not total net worth:
            # before 59.5 the trad and Roth-growth balances are locked behind the
            # 10% penalty, so spending a % of them would propose withdrawals you
            # can't actually take (forcing the bridge to break). accessible() unlocks
            # trad/Roth-growth at 59.5 and seasoned ladder conversions before that,
            # so post-59.5 this equals total net worth.
            pct_base = sum(state.accessible(age).values())
            if strat.rate_mode == "vpw":
                # annuity payout factor: rate rises with age as the horizon nears
                n = max(scenario.profile.horizon_age - age, 1)
                r = strat.vpw_real_return
                rate = (r / (1.0 - (1.0 + r) ** (-n))) if r > 0 else 1.0 / n
            else:
                rate = strat.rate
            disc_target = np.maximum(rate * pct_base - ess_nom, 0.0)
            # endowment (Yale) smoothing: blend the portfolio-driven target with
            # last year's realized discretionary, carried in real terms and reflated.
            if strat.smoothing > 0.0 and prev_disc_real is not None:
                disc_target = (strat.smoothing * (prev_disc_real * infl)
                               + (1.0 - strat.smoothing) * disc_target)
            if strat.bounded:
                disc_target = np.clip(disc_target, strat.floor_mult * disc_nom,
                                      strat.ceiling_mult * disc_nom)
            prev_disc_real = disc_target / np.maximum(infl, 1e-9)
            spend_mult = np.where(disc_nom > 1.0, disc_target / np.maximum(disc_nom, 1.0),
                                  np.ones_like(disc_target))
        elif guard.enabled and t >= t_retire:
            planned = ess_nom + disc_nom
            w = planned / np.maximum(portfolio_start, 1.0)
            if w0 is None:
                w0 = w.copy()
            spend_mult = np.where(w > w0 * (1 + guard.band),
                                  np.maximum(spend_mult * (1 - guard.cut), guard.floor_mult),
                                  spend_mult)
            spend_mult = np.where(w < w0 * (1 - guard.band),
                                  np.minimum(spend_mult * (1 + guard.boost), guard.cap_mult),
                                  spend_mult)

        expenses_nom = ess_nom + disc_nom * spend_mult
        medical_nom = ess_med + disc_med * spend_mult
        hsa_med = np.minimum(scenario.hsa.utilization * medical_nom, state.hsa)
        state.hsa = state.hsa - hsa_med
        oop_expenses = expenses_nom - hsa_med

        # one-time events this year
        general_out = zeros
        forced: dict[WithdrawalSource, np.ndarray] = {}
        windfalls: list[tuple[AccountType, np.ndarray]] = []
        for ev in onetime.get(t, []):
            amount_nom = abs(ev.amount) * infl
            if ev.amount < 0:
                windfalls.append((ev.account or AccountType.taxable, amount_nom))
            elif ev.account is None:
                general_out = general_out + amount_nom
            else:
                src = _FORCED_SOURCE[ev.account]
                forced[src] = forced.get(src, 0) + amount_nom
        # housing: down payment at purchase (from a chosen account, realizing any
        # gains; None routes it through the withdrawal policy like a general outflow);
        # net sale proceeds (windfall) at the sale year. Deterministic nominal scalars.
        if t in housing_forced:
            _acct, _amt = housing_forced[t]
            if _acct is None:
                general_out = general_out + (zeros + _amt)
            else:
                _src = _FORCED_SOURCE[_acct]
                forced[_src] = forced.get(_src, 0) + (zeros + _amt)
        if t in housing_windfall:
            _acct, _amt = housing_windfall[t]
            windfalls.append((_acct, zeros + _amt))

        cash_interest = state.cash * paths.cash[:, t]
        dividends = state.taxable * regime.weights[0] * div_yield

        limits = _contribution_limits(age, infl, scenario.hsa.coverage)
        conv_active = (conv_rule.kind != "none") and (conv_start <= age <= conv_end)
        if conv_rule.kind != "fill_bracket":
            bracket_top_nom = None
        elif conv_rule.bracket_top == "custom":
            bracket_top_nom = conv_rule.custom_top * infl
        else:
            bracket_top_nom = taxmod.ordinary_bracket_top(conv_rule.bracket_top, tables, infl)
        std_nom = tables_eff.standard_deduction * infl

        # Housing itemized deduction (nominal): mortgage interest + property tax
        # capped at the SALT limit ($10k, treated as today's $ and inflated). The
        # tax engine takes max(standard, itemized). SALT is applied to property tax
        # alone (state income tax is not stacked into the cap) — a documented
        # simplification; see docs/ASSUMPTIONS.md.
        itemized_nom = zeros
        if housing is not None and scenario.housing.itemize_deductions:
            salt = np.minimum(housing.property_tax[t], 10000.0 * infl)
            itemized_nom = housing.interest[t] + salt

        # Bracket-filled decumulation ceiling (59.5+ only). The traditional
        # spending draw is capped so its ordinary income tops out here; the
        # ladder (above) then fills any room the spending draw leaves. Inert
        # before 59.5, where traditional is locked behind the penalty anyway.
        wd_active = policy.mode == "bracket_filled" and age >= PENALTY_FREE_AGE
        if not wd_active:
            wd_top_nom = None
        elif policy.bracket_top == "custom":
            wd_top_nom = policy.custom_top * infl
        else:
            wd_top_nom = taxmod.ordinary_bracket_top(policy.bracket_top, tables, infl)

        # ---- fixed-point: taxes <-> contributions <-> withdrawals <-> conversions
        pretax = zeros
        conv = zeros
        contrib: dict[AccountType, np.ndarray] = {}
        match = zeros
        wplan = None
        # health-cost feedback (MAGI -> ACA subsidy / IRMAA -> cash flow) co-converges
        # inside the same fixed point; persist the last-iteration values for recording.
        aca_subsidy = zeros
        net_premium = zeros
        irmaa_cost = zeros
        aca_active = aca.enabled and age >= retirement_age and age < aca.coverage_end_age
        irmaa_active = irmaa.enabled and age >= irmaa.start_age
        prev_state: tuple | None = None
        for _ in range(FIXED_POINT_ITERATIONS):
            w_ordinary = wplan.ordinary_income if wplan is not None else zeros
            w_ltcg = wplan.ltcg_income if wplan is not None else zeros
            w_penalty = wplan.penalty_base if wplan is not None else zeros

            # Income tax co-resolves the SS provisional-income test (the "tax
            # torpedo") and LTCG stacking; see taxes.income_tax. Unpack the few
            # pieces the cash-flow / MAGI / bracket-fill logic below still needs.
            tax = taxmod.income_tax(
                wages=wages, pretax=pretax, rmd=rmd, conversions=conv,
                withdrawal_ordinary=w_ordinary, cash_interest=cash_interest,
                dividends=dividends, withdrawal_ltcg=w_ltcg,
                withdrawal_penalty_base=w_penalty, ss_benefits=ss_nom,
                tables=tables, tables_eff=tables_eff, infl=infl,
                state_rate=scenario.profile.state_tax_rate,
                itemized=itemized_nom,
            )
            ordinary_excl_ss = tax.ordinary_excl_ss
            ltcg = tax.ltcg
            ordinary = tax.ordinary
            fed = tax.federal
            state_tax = tax.state
            total_tax = tax.total

            # Health costs key off MAGI and feed back into cash flow, so they
            # co-converge with taxes/withdrawals inside this fixed point. MAGI is
            # AGI-based, so it must include capital gains (unlike `ordinary`).
            # ACA MAGI also adds back untaxed Social Security; IRMAA uses AGI.
            if aca_active:
                aca_magi = ordinary_excl_ss + ltcg + ss_nom
                fpl_nom = aca.fpl_base_single * infl
                applic = _aca_applicable_pct(aca_magi / np.maximum(fpl_nom, 1.0))
                benchmark = aca.benchmark_annual * infl
                actual = aca.actual_annual * infl
                aca_subsidy = np.clip(benchmark - applic * aca_magi, 0.0, actual)
                net_premium = np.maximum(actual - aca_subsidy, 0.0)
            if irmaa_active:
                irmaa_cost = _irmaa_surcharge(ordinary + ltcg, irmaa.brackets, infl)

            cash_flow = (wages + ss_nom + rmd - total_tax - oop_expenses - general_out
                         - net_premium - irmaa_cost)
            available = np.maximum(cash_flow, 0.0)
            need = np.maximum(-cash_flow, 0.0)

            # tax-advantaged contributions require earned income (IRS compensation
            # rule); without wages, surplus flows to the unlimited steps (taxable)
            limits_eff = {k: np.minimum(v, wages) for k, v in limits.items()}
            contrib, pretax, match = _allocate_waterfall(
                available, waterfall_by_year[t], limits_eff, regime.match_pct, wages, infl,
                match_wages=primary_wages,
            )

            # headroom for the traditional+HSA spending draw before the ceiling:
            # the ceiling less the involuntary ordinary income (wages, RMD, cash
            # interest, taxable SS) already filling it. Subtracting this year's
            # discretionary trad/HSA draw and the conversion keeps it a function
            # of the converging base; co-converges like `conv` over the iterations.
            if wd_active:
                base_ordinary = ordinary - w_ordinary - conv
                trad_cap = np.maximum(wd_top_nom + std_nom - base_ordinary, 0.0)
            else:
                trad_cap = None

            wplan = plan_withdrawals(
                state, need, age, policy.order_for_age(age, PENALTY_FREE_AGE),
                cash_buffer_nominal=policy.cash_buffer * infl,
                allow_early_trad=policy.allow_early_trad_with_penalty,
                forced=forced or None,
                trad_ordinary_cap=trad_cap,
            )

            if conv_active:
                ordinary_excl_conv = ordinary - conv
                if conv_rule.kind == "fixed":
                    target = conv_rule.annual_amount * infl
                else:
                    target = np.maximum(bracket_top_nom + std_nom - ordinary_excl_conv, 0.0)
                conv = np.minimum(target, np.maximum(state.trad - wplan.takes[WithdrawalSource.trad], 0.0))

            # The carried fixed-point state is (pretax, conv, wplan); PortfolioState
            # isn't mutated until after the loop, so once this state stops changing
            # the remaining iterations would reproduce it exactly. Break on exact
            # equality — the result stays byte-identical to the full iteration sweep,
            # we just skip the redundant passes once converged.
            state_sig = (pretax, conv, wplan.ordinary_income,
                         wplan.ltcg_income, wplan.penalty_base)
            if prev_state is not None and all(
                np.array_equal(a, b) for a, b in zip(state_sig, prev_state)
            ):
                break
            prev_state = state_sig

        # ---- apply the converged plan
        apply_plan(state, wplan, age)
        # A path fails if spending went unfunded (hard shortfall) OR it could only
        # be funded by tapping traditional accounts before 59.5 and eating the 10%
        # penalty. Relying on the early-withdrawal penalty is a planning failure,
        # not a success the headline rate should hide — so the global success rate
        # now agrees with the bridge's break definition (metrics.bridge_analysis).
        # penalty_base is nonzero only before PENALTY_FREE_AGE, so post-60 years
        # are unaffected.
        fail[:, t] = (wplan.shortfall > 1.0) | (wplan.penalty_base > 1.0)
        shortfall_out[:, t] = wplan.shortfall
        # `need` holds the converged pre-withdrawal cash-flow gap (taxes included);
        # penalty_base is the early trad/HSA draw the 10% penalty falls on.
        need_out[:, t] = need
        penalty_out[:, t] = tables.early_penalty * wplan.penalty_base
        # gross income that hit the year: wages, SS, RMD, investment income, and the
        # taxable portion of withdrawals (trad = ordinary, taxable sale = the gain).
        # Roth conversions are excluded — an internal transfer, not new income. The
        # denominator for the lifetime effective tax rate.
        gross_income_out[:, t] = (
            wages + ss_nom + rmd + cash_interest + dividends
            + wplan.ordinary_income + wplan.ltcg_income)
        wages_out[:, t] = wages
        for _src, _amt in wplan.takes.items():
            withdrawals_out.setdefault(_src.value, np.zeros((P, T)))[:, t] = _amt

        # marginal federal+state tax rate on the next dollar of Roth conversion
        # (ordinary income): captures the bracket, the Social Security
        # provisional-income "torpedo", and any long-term gains pushed out of the
        # 0% band. A finite difference around the converged plan — it tells you
        # what filling the bracket one notch higher would actually cost.
        bump = 1000.0 * infl
        ss_bumped = taxmod.taxable_social_security(ordinary_excl_ss + bump + ltcg, ss_nom, tables)
        fed_b, ot_b, lt_b = taxmod.federal_tax(ordinary_excl_ss + bump + ss_bumped, ltcg, tables_eff, infl, itemized_nom)
        tax_b = fed_b + scenario.profile.state_tax_rate * (ot_b + lt_b)
        conv_marginal_rate[:, t] = (tax_b - (fed + state_tax)) / bump

        # Tax attributable to THIS year's Roth conversion: the year's income tax
        # minus what it would have been with the conversion removed. The conversion
        # inflates ordinary income (and can drag SS into the tax base or push LTCG
        # out of the 0% band), so this counterfactual captures the full added tax —
        # the cash you must source to convert, distinct from the tax you'd owe
        # anyway. FICA/penalty don't depend on the conversion, so only fed+state move.
        if conv_active:
            oe_nc = ordinary_excl_ss - conv
            ss_nc = taxmod.taxable_social_security(oe_nc + ltcg, ss_nom, tables)
            fed_nc, ot_nc, lt_nc = taxmod.federal_tax(oe_nc + ss_nc, ltcg, tables_eff, infl, itemized_nom)
            tax_nc = fed_nc + scenario.profile.state_tax_rate * (ot_nc + lt_nc)
            conv_tax_out[:, t] = np.maximum((fed + state_tax) - tax_nc, 0.0)

        # average (effective) fed+state income-tax rate on the year's taxable
        # income — the much-lower companion line to the marginal rate, which is
        # what people actually pay and tends to match a personal tax sheet.
        income_base = ordinary + ltcg
        effective_rate_out[:, t] = np.divide(
            fed + state_tax, income_base, out=np.zeros(P), where=income_base > 1.0)

        leftover = available
        for acc_type, amount in contrib.items():
            leftover = leftover - amount
            if acc_type is AccountType.taxable:
                state.taxable = state.taxable + amount
                state.taxable_basis = state.taxable_basis + amount
                contrib_pools_out["taxable"][:, t] += amount
            elif acc_type in (AccountType.trad_401k, AccountType.trad_ira):
                state.trad = state.trad + amount
                contrib_pools_out["trad"][:, t] += amount
            elif acc_type in ROTH_TYPES:
                state.roth = state.roth + amount
                state.roth_contrib_basis = state.roth_contrib_basis + amount
                contrib_pools_out["roth"][:, t] += amount
            elif acc_type is AccountType.hsa:
                state.hsa = state.hsa + amount
                contrib_pools_out["hsa"][:, t] += amount
            elif acc_type is AccountType.cash:
                state.cash = state.cash + amount
                contrib_pools_out["cash"][:, t] += amount
        state.cash = state.cash + np.maximum(leftover, 0.0)
        contrib_pools_out["cash"][:, t] += np.maximum(leftover, 0.0)
        state.trad = state.trad + match
        contrib_pools_out["match"][:, t] = match

        if conv_active:
            state.convert(conv, t)
            conversions_out[:, t] = conv

        for acc_type, amount in windfalls:
            if acc_type is AccountType.cash:
                state.cash = state.cash + amount
            elif acc_type in (AccountType.trad_401k, AccountType.trad_ira):
                state.trad = state.trad + amount
            elif acc_type in ROTH_TYPES:
                state.roth = state.roth + amount
                state.roth_contrib_basis = state.roth_contrib_basis + amount
            elif acc_type is AccountType.hsa:
                state.hsa = state.hsa + amount
            else:
                state.taxable = state.taxable + amount
                state.taxable_basis = state.taxable_basis + amount

        state.taxable_basis = state.taxable_basis + dividends

        # ---- growth and recording
        weights = regime.weights
        blended = (weights[0] * paths.stock[:, t] + weights[1] * paths.bond[:, t]
                   + weights[2] * paths.cash[:, t])
        # Fund expense ratio drags the invested (stock + bond) portion only; the
        # cash pool is held directly, not in a fund. Recorded into port_return so
        # the realized-return fan reflects the net-of-fees return you actually earn.
        blended = blended - expense_ratio * (weights[0] + weights[1])
        port_return_out[:, t] = blended
        state.grow(blended, paths.cash[:, t],
                   hsa_cash_buffer=scenario.hsa.cash_buffer * infl)

        nw[:, t + 1] = state.total_net_worth() - liab_balance[t + 1]
        for n in pool_names:
            pools[n][:, t + 1] = getattr(state, n)
        taxes_paid[:, t] = total_tax
        rmds_out[:, t] = rmd
        spending_mult_out[:, t] = spend_mult
        aca_subsidy_out[:, t] = aca_subsidy
        net_health_cost_out[:, t] = net_premium + irmaa_cost
        ss_out[:, t] = ss_nom
        expenses_out[:, t] = expenses_nom
        contributions_out[:, t] = sum(contrib.values(), start=zeros) + match
        for src, amount in state.accessible(age).items():
            accessible_out.setdefault(src, np.zeros((P, T)))[:, t] = amount

    # die-with-zero floor: did each path end with at least the legacy target (real)?
    legacy_target = scenario.sim.legacy_target
    real_ending = nw[:, -1] / paths.cum_inflation[:, -1]
    legacy_met = real_ending >= legacy_target if legacy_target > 0 else np.ones(P, dtype=bool)

    return SimResult(
        scenario=original_scenario,
        ages=np.arange(start_age, start_age + T),
        years=np.arange(scenario.sim.start_year, scenario.sim.start_year + T),
        cum_inflation=paths.cum_inflation,
        net_worth=nw,
        pools=pools,
        fail=fail,
        taxes_paid=taxes_paid,
        spending_mult=spending_mult_out,
        conversions=conversions_out,
        accessible=accessible_out,
        ss_income=ss_out,
        expenses=expenses_out,
        contributions=contributions_out,
        contrib_pools=contrib_pools_out,
        liability_balance=liab_balance,
        home_value=(housing.home_value if housing is not None else None),
        home_mortgage_balance=(housing.mortgage_balance if housing is not None else None),
        conversion_marginal_rate=conv_marginal_rate,
        conversion_tax=conv_tax_out,
        effective_rate=effective_rate_out,
        rmds=rmds_out,
        port_return=port_return_out,
        aca_subsidy=aca_subsidy_out,
        net_health_cost=net_health_cost_out,
        shortfall=shortfall_out,
        withdrawals=withdrawals_out,
        penalty_paid=penalty_out,
        spending_need=need_out,
        gross_income=gross_income_out,
        wages=wages_out,
        legacy_met=legacy_met,
        ss_estimated_monthly_at_fra=ss_estimated_monthly,
    )


_FORCED_SOURCE = {
    AccountType.taxable: WithdrawalSource.taxable,
    AccountType.cash: WithdrawalSource.cash,
    AccountType.trad_401k: WithdrawalSource.trad,
    AccountType.trad_ira: WithdrawalSource.trad,
    AccountType.roth_ira: WithdrawalSource.roth_basis,
    AccountType.roth_401k: WithdrawalSource.roth_basis,
    AccountType.hsa: WithdrawalSource.hsa,
}
