"""The standard metric bundle the API returns alongside the fan."""

from __future__ import annotations

import numpy as np

from ..engine import SimResult
from .common import _flow_deflator, percentile_fan
from .bridge import bridge_analysis, ladder_schedule, rmd_schedule
from .distributions import (
    age_at_ruin, ending_balance_distribution, failure_magnitude, lifetime_tax,
    max_drawdown_distribution, sequence_scatter, spending_distribution,
)
from .success import success_ci
from .timeseries import (
    accessibility_fan, accessibility_medians_real, effective_rate_median,
    expenses_fan_real, funded_expenses_real, healthcare_medians_real, inflation_fan,
    investing_medians_real, marginal_rate_median, pool_medians_real, port_return_fan,
    spending_mult_fan, ss_income_median_real, survival_curve, wages_median_real,
    withdrawal_source_medians_real,
)


def _home_series_real(result: SimResult, arr) -> list:
    """Median real (today's $) of a deterministic (T+1,) nominal home series,
    deflated by each path's cumulative inflation. Empty when housing is off."""
    if arr is None:
        return []
    return np.median(arr[None, :] / result.cum_inflation, axis=0).tolist()


def _home_equity_real(result: SimResult) -> list:
    """Median real home equity (value − mortgage). Empty when housing is off."""
    if result.home_value is None or result.home_mortgage_balance is None:
        return []
    equity = result.home_value - result.home_mortgage_balance
    return np.median(equity[None, :] / result.cum_inflation, axis=0).tolist()


def _median_real_return(result: SimResult) -> float:
    """The plan's typical real portfolio CAGR: each path's geometric-mean real
    annual return, taken at the median. Mode-agnostic — in Historical Bootstrap it
    reflects the dataset's realized real return, not the (ignored) entered CAGRs."""
    if result.port_return is None:
        return 0.0
    infl = result.cum_inflation[:, 1:] / result.cum_inflation[:, :-1] - 1.0
    real = (1.0 + result.port_return) / (1.0 + infl) - 1.0
    geo = np.expm1(np.mean(np.log1p(real), axis=1))  # per-path geometric mean
    return float(np.median(geo))


def _nwih_fan(result: SimResult) -> dict:
    """Real net-worth-including-home percentile fan: the financial net-worth fan
    plus the (deterministic) home value. The FIRE math itself is unchanged — this
    is a reported overlay only. Empty when housing is off."""
    if result.home_value is None:
        return {}
    real = (result.net_worth + result.home_value[None, :]) / result.cum_inflation
    return {f"p{p}": np.percentile(real, p, axis=0).tolist() for p in (5, 25, 50, 75, 95)}


def summarize(result: SimResult) -> dict:
    """The standard metric bundle the API returns alongside the fan."""
    sweep = None  # computed separately (expensive)
    return {
        "success_rate": result.success_rate,
        "fan": percentile_fan(result),
        "pool_medians_real": pool_medians_real(result),
        "survival_curve": survival_curve(result),
        "accessibility_real": accessibility_medians_real(result),
        # Bridge fan is framed as the worst 1-in-10 scenario, so it carries
        # p10/p90 bands (not the default p5/p95) — the worst-10% line is the
        # bridge-failure signal the chart highlights.
        "accessibility_fan": accessibility_fan(result, percentiles=(10, 25, 50, 75, 90)),
        "bridge": bridge_analysis(result),
        "withdrawals_real": withdrawal_source_medians_real(result),
        "ladder_schedule": ladder_schedule(result),
        "rmd_schedule": rmd_schedule(result),
        "rmds_median_real": (
            np.median(result.rmds / _flow_deflator(result), axis=0).tolist()
            if result.rmds is not None else []
        ),
        "taxes_median_real": np.median(
            result.taxes_paid / _flow_deflator(result), axis=0).tolist(),
        "expenses_median_real": np.median(
            funded_expenses_real(result), axis=0).tolist(),
        "spending_mult_median": np.median(result.spending_mult, axis=0).tolist(),
        "spending_mult_fan": spending_mult_fan(result),
        "expenses_fan_real": expenses_fan_real(result),
        "ss_income_median_real": ss_income_median_real(result),
        "wages_median_real": wages_median_real(result),
        "marginal_rate_median": marginal_rate_median(result),
        "effective_rate_median": effective_rate_median(result),
        "port_return_fan": port_return_fan(result),
        "inflation_fan": inflation_fan(result),
        "lifetime_tax": lifetime_tax(result),
        "failure_magnitude": failure_magnitude(result),
        "investing_real": investing_medians_real(result),
        "liability_balance": (
            result.liability_balance.tolist()
            if result.liability_balance is not None else []
        ),
        # Housing overlay (today's $). The home is reported alongside net worth but
        # stays out of the FIRE-success math; these are empty when housing is off.
        "home_value_real": _home_series_real(result, result.home_value),
        "home_mortgage_real": _home_series_real(result, result.home_mortgage_balance),
        "home_equity_real": _home_equity_real(result),
        "net_worth_incl_home": _nwih_fan(result),
        "median_real_return": _median_real_return(result),
        # outcome-distribution & robustness views (ride every /simulate run)
        "ending_balance": ending_balance_distribution(result),
        "spending_distribution": spending_distribution(result),
        "age_at_ruin": age_at_ruin(result),
        "max_drawdown": max_drawdown_distribution(result),
        "sequence_scatter": sequence_scatter(result),
        "success_ci": success_ci(result),
        "healthcare": healthcare_medians_real(result),
        "ss_estimated_monthly_at_fra": result.ss_estimated_monthly_at_fra,
        "ages": result.ages.tolist(),
        "years": result.years.tolist(),
        "sweep": sweep,
    }
