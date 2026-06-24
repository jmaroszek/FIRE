"""Summary metrics from SimResult, split by concern. Public API unchanged:
import names straight from `fire_engine.metrics`."""

from .common import (
    percentile_fan,
)
from .timeseries import (
    pool_medians_real,
    survival_curve,
    accessibility_medians_real,
    accessibility_fan,
    investing_medians_real,
    ss_income_median_real,
    wages_median_real,
    marginal_rate_median,
    effective_rate_median,
    port_return_fan,
    inflation_fan,
    spending_mult_fan,
    funded_expenses_real,
    expenses_fan_real,
    healthcare_medians_real,
    withdrawal_source_medians_real,
)
from .success import (
    retirement_sweep_full,
    retirement_sweep,
    years_to_fi,
    annual_retirement_expenses,
    fire_number_simple,
    fire_number_mc,
    coast_fire,
    success_ci,
)
from .bridge import (
    bridge_analysis,
    ladder_schedule,
    rmd_schedule,
)
from .distributions import (
    ending_balance_distribution,
    spending_distribution,
    age_at_ruin,
    max_drawdown_distribution,
    sequence_scatter,
    failure_magnitude,
    lifetime_tax,
)
from .surfaces import (
    max_sustainable_spend,
    success_surface,
    sensitivity_tornado,
)
from .stress import (
    income_stress,
    income_stress_earliest,
    bridge_crash_stress,
    tax_regime_stress,
    ladder_tax_savings,
)
from .summary import (
    summarize,
)
