"""Summary metrics computed from SimResult: percentile fans, success
probabilities, the success-vs-retirement-age sweep, FIRE/Coast numbers, the
accessibility series, and the Roth ladder schedule."""

from __future__ import annotations

import numpy as np

from .engine import SimResult, run
from .sampling import MarketPaths, sample_paths
from .scenario import Scenario

DEFAULT_PERCENTILES = (5, 25, 50, 75, 95)


def percentile_fan(result: SimResult,
                   percentiles=DEFAULT_PERCENTILES) -> dict[str, dict[str, list[float]]]:
    """Net-worth percentile bands over time, nominal and real (today's $)."""
    nominal = result.net_worth
    real = nominal / result.cum_inflation
    out: dict[str, dict[str, list[float]]] = {"nominal": {}, "real": {}}
    for p in percentiles:
        out["nominal"][f"p{p}"] = np.percentile(nominal, p, axis=0).tolist()
        out["real"][f"p{p}"] = np.percentile(real, p, axis=0).tolist()
    return out


def pool_medians_real(result: SimResult) -> dict[str, list[float]]:
    return {
        name: np.median(series / result.cum_inflation, axis=0).tolist()
        for name, series in result.pools.items()
    }


def survival_curve(result: SimResult) -> list[float]:
    """P(not yet failed) by end of each sim year."""
    return (1.0 - result.fail.cumsum(axis=1).astype(bool).mean(axis=0)).tolist()


def retirement_sweep(scenario: Scenario, ages: list[int] | None = None,
                     n_paths: int | None = None) -> dict[int, float]:
    """Success probability for each candidate retirement age, reusing one set
    of sampled market paths across all candidates."""
    start_age = scenario.start_age
    if ages is None:
        ages = list(range(start_age, 71))
    paths = sample_paths(scenario, n_paths=n_paths)
    out: dict[int, float] = {}
    for age in ages:
        if age < start_age:
            continue
        out[age] = run(scenario, paths=paths, retirement_age=age).success_rate
    return out


def years_to_fi(sweep: dict[int, float], threshold: float, start_age: int) -> int | None:
    for age in sorted(sweep):
        if sweep[age] >= threshold:
            return age - start_age
    return None


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
    return 25.0 * annual_retirement_expenses(scenario, scenario.retirement_age)


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


def coast_fire(scenario: Scenario) -> dict[str, float]:
    """How much you'd need TODAY to hit the simple FIRE number by the coast
    target age with no further contributions, at the blended real CAGR."""
    target_age = scenario.sim.coast_target_age
    fire = 25.0 * annual_retirement_expenses(scenario, target_age)
    w = scenario.allocation
    r = (w.stocks * scenario.market.stocks.real_cagr
         + w.bonds * scenario.market.bonds.real_cagr
         + w.cash * scenario.market.cash.real_cagr)
    years = max(target_age - scenario.start_age, 0)
    coast_number = fire / (1 + r) ** years
    current = sum(a.balance for a in scenario.accounts)
    return {
        "coast_number": coast_number,
        "progress": current / coast_number if coast_number > 0 else 0.0,
        "fire_number_at_target": fire,
        "assumed_real_return": r,
        "years_to_target": years,
    }


def accessibility_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median accessible dollars by source per year, in today's dollars."""
    deflate = result.cum_inflation[:, 1:]
    return {
        src: np.median(series / deflate, axis=0).tolist()
        for src, series in result.accessible.items()
    }


def ladder_schedule(result: SimResult) -> list[dict]:
    """Median Roth conversion per year (real), with maturation year."""
    deflate = result.cum_inflation[:, 1:]
    med = np.median(result.conversions / deflate, axis=0)
    out = []
    for i, amount in enumerate(med):
        if amount > 1.0:
            out.append({
                "year": int(result.years[i]),
                "age": int(result.ages[i]),
                "amount_real": float(amount),
                "matures": int(result.years[i]) + 5,
            })
    return out


def summarize(result: SimResult) -> dict:
    """The standard metric bundle the API returns alongside the fan."""
    sweep = None  # computed separately (expensive)
    return {
        "success_rate": result.success_rate,
        "fan": percentile_fan(result),
        "pool_medians_real": pool_medians_real(result),
        "survival_curve": survival_curve(result),
        "accessibility_real": accessibility_medians_real(result),
        "ladder_schedule": ladder_schedule(result),
        "taxes_median_real": np.median(
            result.taxes_paid / result.cum_inflation[:, 1:], axis=0).tolist(),
        "expenses_median_real": np.median(
            result.expenses / result.cum_inflation[:, 1:], axis=0).tolist(),
        "ages": result.ages.tolist(),
        "years": result.years.tolist(),
        "sweep": sweep,
    }
