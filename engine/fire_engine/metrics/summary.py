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
