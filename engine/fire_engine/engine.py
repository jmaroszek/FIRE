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
    HSA_PENALTY_FREE_AGE,
    PENALTY_FREE_AGE,
    PortfolioState,
    apply_plan,
    plan_withdrawals,
)
from .sampling import MarketPaths, sample_paths
from .scenario import (
    AccountType,
    Allocation,
    EventKind,
    ROTH_TYPES,
    SS_CLAIMING_FACTORS,
    Scenario,
    TaxRegimeShock,
    WaterfallStep,
    WithdrawalSource,
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


RMD_START_AGE = 75  # SECURE 2.0, born 1960+
# Default last age for the Roth conversion ladder. The ladder serves two jobs:
# bridging to 59.5 AND shrinking the traditional balance before RMDs begin, so
# the default runs well past 59.5 — stopping a couple of years short of RMDs,
# where the next converted dollar starts competing with forced RMD income.
LADDER_DEFAULT_END_AGE = 72


@dataclass
class YearRegime:
    salary_real: float
    match_pct: float
    weights: tuple[float, float, float]  # stocks, bonds, cash


def _liability_schedule(scenario: Scenario, T: int) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic nominal amortization of all liabilities.

    Returns (payments (T,), outstanding balance (T+1,)). Loans are nominal
    contracts: payments are fixed dollars, identical across paths.
    """
    payments = np.zeros(T)
    balance = np.zeros(T + 1)
    for liab in scenario.liabilities:
        bal = max(liab.balance, 0.0)
        balance[0] += bal
        for t in range(T):
            if bal <= 1e-9:
                break
            bal *= 1.0 + liab.interest_rate
            pay = min(liab.annual_payment, bal)
            payments[t] += pay
            bal -= pay
            balance[t + 1] += bal
    return payments, balance


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
    conversion_marginal_rate: np.ndarray | None = None  # (P, T) marginal tax on next conversion $
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

    @property
    def success_rate(self) -> float:
        return float(1.0 - self.fail.any(axis=1).mean())


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
    growth = scenario.income.effective_real_growth(mean_infl)
    match = scenario.income.employer_match_pct
    alloc = scenario.allocation
    segment_start = 0
    salary_set_at = -1  # sim-year when salary was last explicitly set

    for t in range(T):
        if t in regime_events:
            # salary compounds up to the event, then the overrides take effect
            salary = salary * (1 + growth) ** (t - segment_start)
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
        age = start_age + t
        salary_t = salary * (1 + growth) ** (t - segment_start)
        retired = age >= retirement_age
        # retirement zeroes the salary unless a regime event at/after the
        # retirement year explicitly set one (e.g. barista FIRE)
        if retired and salary_set_at < retirement_age - start_age:
            salary_t = 0.0
        out.append(YearRegime(salary_real=salary_t, match_pct=match,
                              weights=(alloc.stocks, alloc.bonds, alloc.cash)))
    return out


def _expenses_for_year(scenario: Scenario, t: int, age: int,
                       cum_infl: np.ndarray) -> tuple[np.ndarray, ...]:
    """(essential, discretionary, essential_medical, discretionary_medical),
    each (P,) nominal. Discretionary streams are subject to guardrail cuts."""
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
    return ess, disc, ess_med, disc_med


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
) -> tuple[dict[AccountType, np.ndarray], np.ndarray, np.ndarray]:
    """Allocate positive free cash flow down the waterfall.

    Returns (contributions by account type, pretax total, employer match).
    Pure function of the inputs; capped by group limits and available cash.
    """
    remaining = np.maximum(available, 0.0).copy()
    group_left = {k: v.copy() for k, v in limits.items()}
    contrib: dict[AccountType, np.ndarray] = {}

    for step in steps:
        group = _LIMIT_GROUP.get(step.account)
        cap = group_left[group] if group else np.full_like(remaining, np.inf)
        if step.kind == "to_match":
            want = np.minimum(match_pct * wages, cap)
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
    match = np.where(employee_401k > 0, match_pct * wages, 0.0)
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
    spending_scale: float = 1.0,
    tax_regime: TaxRegimeShock | None = None,
    deterministic: bool = False,
) -> SimResult:
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

    # group one-time flow events by sim year
    onetime: dict[int, list] = {}
    for ev in scenario.events:
        if ev.kind is EventKind.one_time_flow:
            t = scenario.event_year_index(ev)
            if 0 <= t < T:
                onetime.setdefault(t, []).append(ev)

    conv_rule = scenario.conversion_rule
    conv_start = conv_rule.start_age if conv_rule.start_age is not None else retirement_age
    conv_end = conv_rule.end_age if conv_rule.end_age is not None else LADDER_DEFAULT_END_AGE

    ss = scenario.social_security
    ss_factor = SS_CLAIMING_FACTORS.get(ss.claiming_age, 1.0)
    ss_annual_real = ss.monthly_at_fra * 12 * ss_factor * ss.haircut

    policy = scenario.withdrawal_policy
    div_yield = scenario.market.dividend_yield
    aca = scenario.aca
    irmaa = scenario.irmaa

    liab_payments, liab_balance = _liability_schedule(scenario, T)

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

        wages = regime.salary_real * infl
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
        if spending_scale != 1.0:
            ess_nom = ess_med + (ess_nom - ess_med) * spending_scale
            disc_nom = disc_med + (disc_nom - disc_med) * spending_scale
        ess_nom = ess_nom + liab_payments[t]  # loan payments: essential, non-inflating

        if t >= t_retire and strat.kind != "constant_dollar":
            # Portfolio-percentage family: discretionary spending is set from the
            # CURRENT balance each year, so it self-corrects with the market and
            # never depletes to zero. Essentials (medical + loan payments, already
            # folded into ess_nom) are funded first; whatever the rule leaves above
            # them becomes the discretionary budget. spend_mult is recomputed fresh
            # each year (no ratchet), unlike the guardrail path.
            if strat.kind == "vpw":
                # annuity payout factor: rate rises with age as the horizon nears
                n = max(scenario.profile.horizon_age - age, 1)
                r = strat.vpw_real_return
                rate = (r / (1.0 - (1.0 + r) ** (-n))) if r > 0 else 1.0 / n
            else:
                rate = strat.rate
            disc_target = np.maximum(rate * portfolio_start - ess_nom, 0.0)
            if strat.kind == "floor_ceiling":
                disc_target = np.clip(disc_target, strat.floor_mult * disc_nom,
                                      strat.ceiling_mult * disc_nom)
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
        for _ in range(FIXED_POINT_ITERATIONS):
            w_ordinary = wplan.ordinary_income if wplan is not None else zeros
            w_ltcg = wplan.ltcg_income if wplan is not None else zeros
            w_penalty = wplan.penalty_base if wplan is not None else zeros

            ordinary_excl_ss = (
                np.maximum(wages - pretax, 0.0)
                + rmd + conv + w_ordinary + cash_interest
            )
            ltcg = dividends + w_ltcg
            # Social Security taxation follows the IRS provisional-income test:
            # other (non-SS) income plus half the benefit decides how much of the
            # benefit (0/50/85%) is taxed — the source of the "tax torpedo" that a
            # flat fraction would hide from bracket-management decisions.
            taxable_ss = taxmod.taxable_social_security(ordinary_excl_ss + ltcg, ss_nom, tables)
            ordinary = ordinary_excl_ss + taxable_ss
            fed, ord_taxable, ltcg_taxable = taxmod.federal_tax(ordinary, ltcg, tables_eff, infl)
            state_tax = scenario.profile.state_tax_rate * (ord_taxable + ltcg_taxable)
            fica = taxmod.fica_tax(wages, tables, infl)
            penalty = tables.early_penalty * w_penalty
            total_tax = fed + state_tax + fica + penalty

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
                available, scenario.waterfall, limits_eff, regime.match_pct, wages, infl
            )

            wplan = plan_withdrawals(
                state, need, age, policy.order_for_age(age, PENALTY_FREE_AGE),
                cash_buffer_nominal=policy.cash_buffer * infl,
                allow_early_trad=policy.allow_early_trad_with_penalty,
                forced=forced or None,
            )

            if conv_active:
                ordinary_excl_conv = ordinary - conv
                if conv_rule.kind == "fixed":
                    target = conv_rule.annual_amount * infl
                else:
                    target = np.maximum(bracket_top_nom + std_nom - ordinary_excl_conv, 0.0)
                conv = np.minimum(target, np.maximum(state.trad - wplan.takes[WithdrawalSource.trad], 0.0))

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
        for _src, _amt in wplan.takes.items():
            withdrawals_out.setdefault(_src.value, np.zeros((P, T)))[:, t] = _amt

        # marginal federal+state tax rate on the next dollar of Roth conversion
        # (ordinary income): captures the bracket, the Social Security
        # provisional-income "torpedo", and any long-term gains pushed out of the
        # 0% band. A finite difference around the converged plan — it tells you
        # what filling the bracket one notch higher would actually cost.
        bump = 1000.0 * infl
        ss_bumped = taxmod.taxable_social_security(ordinary_excl_ss + bump + ltcg, ss_nom, tables)
        fed_b, ot_b, lt_b = taxmod.federal_tax(ordinary_excl_ss + bump + ss_bumped, ltcg, tables_eff, infl)
        tax_b = fed_b + scenario.profile.state_tax_rate * (ot_b + lt_b)
        conv_marginal_rate[:, t] = (tax_b - (fed + state_tax)) / bump

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

    return SimResult(
        scenario=scenario,
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
        conversion_marginal_rate=conv_marginal_rate,
        rmds=rmds_out,
        port_return=port_return_out,
        aca_subsidy=aca_subsidy_out,
        net_health_cost=net_health_cost_out,
        shortfall=shortfall_out,
        withdrawals=withdrawals_out,
        penalty_paid=penalty_out,
        spending_need=need_out,
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
