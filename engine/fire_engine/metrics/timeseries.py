"""Per-year median and percentile-fan series."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan


def pool_medians_real(result: SimResult) -> dict[str, list[float]]:
    return {
        name: np.median(series / result.cum_inflation, axis=0).tolist()
        for name, series in result.pools.items()
    }


def survival_curve(result: SimResult) -> list[float]:
    """P(not yet failed) by end of each sim year."""
    return (1.0 - result.fail.cumsum(axis=1).astype(bool).mean(axis=0)).tolist()


def accessibility_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median accessible dollars by source per year, in today's dollars."""
    deflate = result.cum_inflation[:, 1:]
    return {
        src: np.median(series / deflate, axis=0).tolist()
        for src, series in result.accessible.items()
    }


def accessibility_fan(result: SimResult,
                      percentiles=DEFAULT_PERCENTILES) -> dict[str, list[float]]:
    """Percentile fan of TOTAL penalty-free accessible dollars over time (real).

    The median accessibility *stack* shows composition but hides the tail; this
    shows dispersion. The low percentile is the bridge-failure signal — a p5 line
    diving toward zero before 59½ means the penalty-free runway runs dry in bad
    markets even when the median path looks comfortable."""
    if not result.accessible:
        return {}
    deflate = result.cum_inflation[:, 1:]  # accessible is an end-of-year stock
    total = sum(result.accessible.values()) / deflate
    return {f"p{p}": np.percentile(total, p, axis=0).tolist() for p in percentiles}


def investing_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median annual contribution by destination, in today's dollars.
    'cash' includes unallocated surplus that pools in the cash account;
    'match' is the employer contribution."""
    deflate = _flow_deflator(result)  # contributions are a flow
    return {
        name: np.median(series / deflate, axis=0).tolist()
        for name, series in (result.contrib_pools or {}).items()
    }


def ss_income_median_real(result: SimResult) -> list[float]:
    """Median Social Security benefit per year in today's dollars (a flow)."""
    return np.median(result.ss_income / _flow_deflator(result), axis=0).tolist()


def wages_median_real(result: SimResult) -> list[float]:
    """Median active (work) income per year in today's dollars — salary plus any
    secondary streams. The 'are you funding life from a paycheck or your accounts?'
    band on the funding-sources chart."""
    if result.wages is None:
        return []
    return np.median(result.wages / _flow_deflator(result), axis=0).tolist()


def marginal_rate_median(result: SimResult) -> list[float]:
    """Median marginal fed+state rate on the next conversion dollar, per year —
    the lifetime view of the per-cell rate the ladder/RMD tables already sample."""
    if result.conversion_marginal_rate is None:
        return []
    return np.median(result.conversion_marginal_rate, axis=0).tolist()


def effective_rate_median(result: SimResult) -> list[float]:
    """Median effective (average) fed+state income-tax rate per year — the
    much-lower companion to the marginal rate: total income tax over taxable
    income, which is what actually lands on a personal tax sheet."""
    if result.effective_rate is None:
        return []
    return np.median(result.effective_rate, axis=0).tolist()


def port_return_fan(result: SimResult,
                    percentiles=DEFAULT_PERCENTILES) -> dict[str, list[float]]:
    """Percentile fan of REAL annual portfolio return over time."""
    if result.port_return is None:
        return {}
    infl = result.cum_inflation[:, 1:] / result.cum_inflation[:, :-1] - 1.0
    real_ret = (1 + result.port_return) / (1 + infl) - 1.0
    return {f"p{p}": np.percentile(real_ret, p, axis=0).tolist() for p in percentiles}


def inflation_fan(result: SimResult,
                  percentiles=DEFAULT_PERCENTILES) -> dict[str, list[float]]:
    """Percentile fan of the cumulative price level (index, today = 1.0) over the
    horizon. Inflation is the dominant solo-retiree tail this model encodes — the
    un-indexed SS provisional-income thresholds make the tax torpedo worsen in real
    terms by construction — yet the dispersion is otherwise invisible behind 'real' views."""
    return {f"p{p}": np.percentile(result.cum_inflation, p, axis=0).tolist()
            for p in percentiles}


def spending_mult_fan(result: SimResult,
                      percentiles=(10, 25, 50, 75, 90)) -> dict[str, list[float]]:
    """Percentile fan of the discretionary spending multiplier (realized vs plan)
    over time. The median alone hides that on the bad paths guardrails cut spending
    to the floor; the low percentiles make that downside — the very paths that
    later run short — visible beside the median. Realized spending is capped at the
    plan, so only the downside (10th/25th) carries information; the chart shows just
    that side."""
    return {f"p{p}": np.percentile(result.spending_mult, p, axis=0).tolist()
            for p in percentiles}


def funded_expenses_real(result: SimResult) -> np.ndarray:
    """Realized spending each path actually FUNDS, in real (today's) dollars. Equal
    to the budgeted expense less any unfunded shortfall (the spending a path couldn't
    withdraw enough to cover), so on paths that run dry the line drops instead of
    promising a budget that can't be paid. Liquidity-honest: the percent-of-portfolio
    strategies budget off accessible wealth, so pre-59.5 this won't overstate what
    the locked balances could fund."""
    budget = result.expenses
    if result.shortfall is not None:
        budget = np.maximum(budget - result.shortfall, 0.0)
    return budget / _flow_deflator(result)


def expenses_fan_real(result: SimResult,
                      percentiles=(10, 25, 50)) -> dict[str, list[float]]:
    """Percentile fan of realized funded spending in real (today's) dollars over
    time. Unlike spending_mult_fan (which is the discretionary multiplier vs plan),
    this is the actual dollar lifestyle each path funds — essentials are already
    baked in, so the low percentiles show how far spending can dip. Powers the
    in-tile Spending Strategy preview (median line + downside band)."""
    real = funded_expenses_real(result)
    return {f"p{p}": np.percentile(real, p, axis=0).tolist() for p in percentiles}


def healthcare_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median net healthcare cost (ACA premium after subsidy + IRMAA) and ACA
    subsidy per year, in today's dollars. Empty when neither is enabled."""
    deflate = _flow_deflator(result)
    out: dict[str, list[float]] = {}
    if result.net_health_cost is not None:
        out["net_cost_real"] = np.median(result.net_health_cost / deflate, axis=0).tolist()
    if result.aca_subsidy is not None:
        out["subsidy_real"] = np.median(result.aca_subsidy / deflate, axis=0).tolist()
    return out


def withdrawal_source_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median amount actually withdrawn from each source per year, today's dollars.
    Unlike `accessibility_real` (what was *available* penalty-free), this is what the
    withdrawal policy actually *drew* — so you can see the funding sequence the policy
    order produces, and whether it behaves as configured."""
    if result.withdrawals is None:
        return {}
    deflate = _flow_deflator(result)
    return {src: np.median(amt / deflate, axis=0).tolist()
            for src, amt in result.withdrawals.items()}
