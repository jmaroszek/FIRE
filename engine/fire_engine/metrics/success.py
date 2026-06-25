"""Success sweep, years-to-FI, FIRE / Coast numbers, success CI."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan


def retirement_sweep_full(scenario: Scenario, ages: list[int] | None = None,
                          n_paths: int | None = None) -> dict:
    """For each candidate retirement age: success probability AND the median (with
    p25/p75) real ending estate — the die-with-zero companion to the success curve.

    The estate you accumulate by working longer is the explicit price of one more
    year; pairing it with success exposes the over-saving zone, where a later age
    barely lifts success but balloons the estate you'll never spend. One shared set
    of market paths across every candidate age, so both curves are noise-free."""
    start_age = scenario.start_age
    if ages is None:
        ages = list(range(start_age, 71))
    paths = sample_paths(scenario, n_paths=n_paths)
    success: dict[int, float] = {}
    estate_p25: dict[int, float] = {}
    estate_p50: dict[int, float] = {}
    estate_p75: dict[int, float] = {}
    for age in ages:
        if age < start_age:
            continue
        r = run(scenario, paths=paths, retirement_age=age)
        success[age] = r.success_rate
        real_end = r.net_worth[:, -1] / r.cum_inflation[:, -1]
        estate_p25[age] = float(np.percentile(real_end, 25))
        estate_p50[age] = float(np.median(real_end))
        estate_p75[age] = float(np.percentile(real_end, 75))
    return {"success": success, "estate_p25": estate_p25,
            "estate_p50": estate_p50, "estate_p75": estate_p75}


def retirement_sweep(scenario: Scenario, ages: list[int] | None = None,
                     n_paths: int | None = None) -> dict[int, float]:
    """Success probability for each candidate retirement age, reusing one set
    of sampled market paths across all candidates."""
    return retirement_sweep_full(scenario, ages=ages, n_paths=n_paths)["success"]


def years_to_fi(sweep: dict[int, float], threshold: float, start_age: int) -> int | None:
    """Earliest age from which success stays at/above the threshold for every
    later age too. A transient peak (e.g. retiring just before a New Salary
    event resumes income) must not count as 'FI reached'."""
    ages = sorted(sweep)
    sustained_from: int | None = None
    for age in ages:
        if sweep[age] >= threshold:
            if sustained_from is None:
                sustained_from = age
        else:
            sustained_from = None
    return sustained_from - start_age if sustained_from is not None else None


def annual_retirement_expenses(scenario: Scenario, at_age: int) -> float:
    """Sum of expense streams active at a given age, in today's dollars."""
    return sum(
        s.annual
        for s in scenario.expense_streams
        if (s.start_age is None or s.start_age <= at_age)
        and (s.end_age is None or s.end_age >= at_age)
    )


def fire_number_simple(scenario: Scenario) -> float:
    """Classic 25x (4% rule) on expenses at the planned retirement age."""
    return FIRE_MULTIPLE * annual_retirement_expenses(scenario, scenario.retirement_age)


def fire_number_mc(scenario: Scenario, n_paths: int = 1000,
                   tolerance: float = 0.02) -> float | None:
    """Smallest portfolio (today's dollars) for which retiring IMMEDIATELY has
    success probability >= the scenario threshold. Bisects a scale factor
    applied to current balances."""
    current_total = sum(a.balance for a in scenario.accounts)
    if current_total <= 0:
        return None
    threshold = scenario.sim.success_threshold
    paths = sample_paths(scenario, n_paths=n_paths)
    retire_now = scenario.start_age

    def success(scale: float) -> float:
        return run(scenario, paths=paths, retirement_age=retire_now,
                   balance_scale=scale).success_rate

    lo, hi = 0.05, 1.0
    while success(hi) < threshold:
        lo, hi = hi, hi * 2
        if hi > 200:
            return None
    if success(lo) >= threshold:
        hi = lo
        lo = 0.0
    while (hi - lo) * current_total > tolerance * current_total * hi:
        mid = (lo + hi) / 2
        if success(mid) >= threshold:
            hi = mid
        else:
            lo = mid
    return hi * current_total


def _fire_number_mc_at_age(scenario: Scenario, at_age: int,
                           n_paths: int) -> float | None:
    """The Monte-Carlo FIRE number as if the plan starts at `at_age` and retires
    immediately then: the smallest portfolio (today's dollars, same account mix as
    now) whose retirement clears the success threshold. Shifts the sim's start to
    that age so the FIRE target reflects the horizon, expenses, and Social Security
    timing *at that age* — the per-age input the coast discount needs.

    `fire_number_mc` scales current balances, so the absolute balances are
    irrelevant here; only their composition carries through."""
    if at_age <= scenario.start_age:
        return fire_number_mc(scenario, n_paths=n_paths)
    if at_age >= scenario.profile.horizon_age:
        return None  # no years left to simulate a retirement at/after the horizon
    shifted = scenario.model_copy(deep=True)
    shifted.sim.start_year = scenario.profile.birth_year + at_age
    return fire_number_mc(shifted, n_paths=n_paths)


def coast_fire(scenario: Scenario, n_paths: int = 1000) -> dict[str, float | None]:
    """How much you'd need invested TODAY to reach your FIRE number by the coast
    target age with no further contributions, compounding at the blended real CAGR.

    The FIRE target is the Monte-Carlo number — the smallest portfolio that retires
    at the target age with success >= the scenario threshold — not the 25x rule of
    thumb, so the coast goal carries the same sequence-risk, tax, and Social Security
    modeling as the rest of the app. ``coast_number`` is None when there are no
    assets to bisect or the target age leaves no horizon to simulate."""
    target_age = scenario.sim.coast_target_age
    w = scenario.allocation
    r = (w.stocks * scenario.market.stocks.real_cagr
         + w.bonds * scenario.market.bonds.real_cagr
         + w.cash * scenario.market.cash.real_cagr)
    years = max(target_age - scenario.start_age, 0)
    fire = _fire_number_mc_at_age(scenario, target_age, n_paths=n_paths)
    if fire is None:
        return {"coast_number": None, "progress": None,
                "fire_number_at_target": None,
                "assumed_real_return": r, "years_to_target": years}
    coast_number = fire / (1 + r) ** years
    current = sum(a.balance for a in scenario.accounts)
    return {
        "coast_number": coast_number,
        "progress": current / coast_number if coast_number > 0 else 0.0,
        "fire_number_at_target": fire,
        "assumed_real_return": r,
        "years_to_target": years,
    }


def success_ci(result: SimResult, z: float = 1.959963984540054) -> dict:
    """Wilson score interval on the success rate: the Monte-Carlo *sampling error*
    on the probability estimate given n_paths — NOT a confidence interval on the
    user's real-life outcome. Wilson (not normal-approx) because near 95%+ success
    the normal interval spills past 1.0."""
    n = int(result.fail.shape[0])
    failed = result.fail.any(axis=1)
    if result.legacy_met is not None:
        failed = failed | ~result.legacy_met  # legacy floor counts in the headline rate
    k = int((~failed).sum())
    p = k / n if n else 0.0
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return {
        "rate": p,
        "lo": float(max(0.0, center - half)),
        "hi": float(min(1.0, center + half)),
        "n_paths": n,
    }
