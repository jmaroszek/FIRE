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
from dataclasses import dataclass, field
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


@dataclass
class YearRegime:
    salary_real: float
    match_pct: float
    weights: tuple[float, float, float]  # stocks, bonds, cash


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
    salary = scenario.income.gross_salary
    growth = scenario.income.real_growth
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
                    growth = ov.salary_real_growth
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


def run(
    scenario: Scenario,
    paths: MarketPaths | None = None,
    retirement_age: int | None = None,
    balance_scale: float = 1.0,
    deterministic: bool = False,
) -> SimResult:
    tables = taxmod.load_tax_tables()
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
    conv_end = conv_rule.end_age if conv_rule.end_age is not None else PENALTY_FREE_AGE - 2

    ss = scenario.social_security
    ss_factor = SS_CLAIMING_FACTORS.get(ss.claiming_age, 1.0)
    ss_annual_real = ss.monthly_at_fra * 12 * ss_factor * ss.haircut

    policy = scenario.withdrawal_policy
    div_yield = scenario.market.dividend_yield

    # result arrays
    nw = np.zeros((P, T + 1))
    nw[:, 0] = state.total_net_worth()
    pool_names = ("taxable", "trad", "roth", "hsa", "cash")
    pools = {n: np.zeros((P, T + 1)) for n in pool_names}
    for n in pool_names:
        pools[n][:, 0] = getattr(state, n)
    fail = np.zeros((P, T), dtype=bool)
    taxes_paid = np.zeros((P, T))
    spending_mult_out = np.ones((P, T))
    conversions_out = np.zeros((P, T))
    ss_out = np.zeros((P, T))
    expenses_out = np.zeros((P, T))
    contributions_out = np.zeros((P, T))
    accessible_out: dict[str, np.ndarray] = {}

    zeros = np.zeros(P)

    # guardrails: per-path discretionary spending multiplier and the initial
    # withdrawal rate recorded in the retirement year
    guard = scenario.guardrails
    t_retire = max(retirement_age - start_age, 0)
    spend_mult = np.ones(P)
    w0: np.ndarray | None = None

    for t in range(T):
        age = start_age + t
        regime = regimes[t]
        infl = paths.cum_inflation[:, t]
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

        if guard.enabled and t >= t_retire:
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
        bracket_top_nom = (
            taxmod.ordinary_bracket_top(conv_rule.bracket_top, tables, infl)
            if conv_rule.kind == "fill_bracket"
            else None
        )
        std_nom = tables.standard_deduction * infl

        # ---- fixed-point: taxes <-> contributions <-> withdrawals <-> conversions
        pretax = zeros
        conv = zeros
        contrib: dict[AccountType, np.ndarray] = {}
        match = zeros
        wplan = None
        for _ in range(FIXED_POINT_ITERATIONS):
            w_ordinary = wplan.ordinary_income if wplan is not None else zeros
            w_ltcg = wplan.ltcg_income if wplan is not None else zeros
            w_penalty = wplan.penalty_base if wplan is not None else zeros

            ordinary = (
                np.maximum(wages - pretax, 0.0)
                + rmd + conv + w_ordinary + cash_interest
                + tables.ss_taxable_fraction * ss_nom
            )
            ltcg = dividends + w_ltcg
            fed, ord_taxable, ltcg_taxable = taxmod.federal_tax(ordinary, ltcg, tables, infl)
            state_tax = scenario.profile.state_tax_rate * (ord_taxable + ltcg_taxable)
            fica = taxmod.fica_tax(wages, tables, infl)
            penalty = tables.early_penalty * w_penalty
            total_tax = fed + state_tax + fica + penalty

            cash_flow = (wages + ss_nom + rmd - total_tax - oop_expenses - general_out)
            available = np.maximum(cash_flow, 0.0)
            need = np.maximum(-cash_flow, 0.0)

            # tax-advantaged contributions require earned income (IRS compensation
            # rule); without wages, surplus flows to the unlimited steps (taxable)
            limits_eff = {k: np.minimum(v, wages) for k, v in limits.items()}
            contrib, pretax, match = _allocate_waterfall(
                available, scenario.waterfall, limits_eff, regime.match_pct, wages, infl
            )

            wplan = plan_withdrawals(
                state, need, age, policy.order,
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
        fail[:, t] = wplan.shortfall > 1.0

        leftover = available
        for acc_type, amount in contrib.items():
            leftover = leftover - amount
            if acc_type is AccountType.taxable:
                state.taxable = state.taxable + amount
                state.taxable_basis = state.taxable_basis + amount
            elif acc_type in (AccountType.trad_401k, AccountType.trad_ira):
                state.trad = state.trad + amount
            elif acc_type in ROTH_TYPES:
                state.roth = state.roth + amount
                state.roth_contrib_basis = state.roth_contrib_basis + amount
            elif acc_type is AccountType.hsa:
                state.hsa = state.hsa + amount
            elif acc_type is AccountType.cash:
                state.cash = state.cash + amount
        state.cash = state.cash + np.maximum(leftover, 0.0)
        state.trad = state.trad + match

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
        state.grow(blended, paths.cash[:, t])

        nw[:, t + 1] = state.total_net_worth()
        for n in pool_names:
            pools[n][:, t + 1] = getattr(state, n)
        taxes_paid[:, t] = total_tax
        spending_mult_out[:, t] = spend_mult
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
