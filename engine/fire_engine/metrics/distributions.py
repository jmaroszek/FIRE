"""Outcome distributions: ending balance, ruin age, drawdown, lifetime tax."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan


def ending_balance_distribution(result: SimResult) -> dict[str, list[float]]:
    """Per-path net worth at the horizon, nominal and real (today's $). Raw
    samples so the client can bin them and honor the real/nominal toggle without
    a re-fetch. The over-saving / bequest lens: a plan can 'succeed' yet leave a
    huge median estate — years of life traded for money never spent."""
    nominal = result.net_worth[:, -1]
    real = nominal / result.cum_inflation[:, -1]
    return {"nominal": nominal.tolist(), "real": real.tolist()}


def spending_distribution(result: SimResult) -> dict[str, list[float]]:
    """Per-path *delivered* lifetime spending in today's dollars (sum of the
    deflated annual expense flow), and the count of years each path spent in a
    guardrail cut (spending_mult < 1). Two plans can both clear the success bar
    while one quietly under-delivers lifestyle for years."""
    real_annual = result.expenses / _flow_deflator(result)
    total_real = real_annual.sum(axis=1)
    years_in_cut = (result.spending_mult < 1.0 - 1e-9).sum(axis=1)
    return {
        "total_real": total_real.tolist(),
        "years_in_cut": years_in_cut.astype(int).tolist(),
    }


def age_at_ruin(result: SimResult) -> dict:
    """Histogram of the age at which each failing path first fails — a hard
    shortfall, or the first lean on a penalized early traditional draw — plus the
    count that never failed. Uses the global fail flag, so it agrees with the
    survival curve and headline success rate. 'When do plans die?' is more
    actionable than a single success number."""
    failed = result.fail.any(axis=1)
    first_idx = result.fail.argmax(axis=1)  # 0 for never-failed; masked out below
    ruin_ages = result.ages[first_idx][failed]
    if ruin_ages.size:
        uniq, counts = np.unique(ruin_ages, return_counts=True)
        ages, age_counts = uniq.astype(int).tolist(), counts.astype(int).tolist()
    else:
        ages, age_counts = [], []
    return {
        "ages": ages,
        "counts": age_counts,
        "success_paths": int((~failed).sum()),
        "total_paths": int(result.fail.shape[0]),
    }


def max_drawdown_distribution(result: SimResult) -> list[float]:
    """Per-path deepest peak-to-trough decline of REAL net worth (fraction in
    [0,1]). Computed on real net worth so nominal inflation growth can't mask a
    real drawdown — the question that decides whether you'd panic-sell."""
    real = result.net_worth / result.cum_inflation
    running_max = np.maximum.accumulate(real, axis=1)
    drawdown = 1.0 - real / np.maximum(running_max, 1.0)
    return np.clip(drawdown.max(axis=1), 0.0, 1.0).tolist()


def sequence_scatter(result: SimResult, window: int = 10) -> dict:
    """Each path's mean REAL portfolio return over the first `window` years *after
    retirement* paired with its outcome (ending real wealth + survived flag). The
    sequence-of-returns hazard is the decade following the day you stop earning, so
    the window is anchored at the retirement year — for a retire-at-45 plan the
    sim-start window would just measure the accumulation decade, the wrong question."""
    if result.port_return is None:
        return {"first_window_return": [], "ending_real": [], "survived": [],
                "window": window, "start_age": int(result.ages[0])}
    infl = result.cum_inflation[:, 1:] / result.cum_inflation[:, :-1] - 1.0
    real_ret = (1 + result.port_return) / (1 + infl) - 1.0
    T = real_ret.shape[1]
    start_age = int(result.ages[0])
    t_retire = min(max(int(result.scenario.retirement_age) - start_age, 0), max(T - 1, 0))
    w = min(window, T - t_retire)
    first = real_ret[:, t_retire:t_retire + w].mean(axis=1)
    ending_real = result.net_worth[:, -1] / result.cum_inflation[:, -1]
    survived = ~result.fail.any(axis=1)
    return {
        "first_window_return": first.tolist(),
        "ending_real": ending_real.tolist(),
        "survived": survived.tolist(),
        "window": w,
        "start_age": start_age + t_retire,
    }


def failure_magnitude(result: SimResult) -> dict:
    """Depth-of-ruin among the paths that actually run short of money: a binary
    success rate treats a $500 miss at 89 and a collapse at 70 identically. Sized
    on the HARD shortfall, not the global fail flag — the latter now also counts
    early-penalty reliance, where spending was met and the dollar shortfall is
    zero, and including those paths would dilute the severity. For each path that
    runs short, the total real unfunded spending (sum of the deflated annual
    shortfall) and the number of years it spent short."""
    hard_short = (result.shortfall > 1.0) if result.shortfall is not None else result.fail
    failed = hard_short.any(axis=1)
    n_fail = int(failed.sum())
    if n_fail == 0 or result.shortfall is None:
        return {"failing_paths": n_fail, "total_paths": int(result.fail.shape[0]),
                "median_total_shortfall_real": 0.0, "median_years_short": 0.0,
                "p90_total_shortfall_real": 0.0}
    short_real = (result.shortfall / _flow_deflator(result))[failed]
    total = short_real.sum(axis=1)
    years_short = hard_short[failed].sum(axis=1)
    return {
        "failing_paths": n_fail,
        "total_paths": int(result.fail.shape[0]),
        "median_total_shortfall_real": float(np.median(total)),
        "p90_total_shortfall_real": float(np.percentile(total, 90)),
        "median_years_short": float(np.median(years_short)),
    }


def lifetime_tax(result: SimResult) -> dict:
    """Median lifetime real tax for the current plan, as a share of lifetime
    delivered spending, and as an effective rate on lifetime income — the headline
    numbers that tell you whether the ladder / withdrawal-ordering machinery is
    actually working."""
    deflate = _flow_deflator(result)
    tax_real = (result.taxes_paid / deflate).sum(axis=1)
    spend_real = (result.expenses / deflate).sum(axis=1)
    med_tax = float(np.median(tax_real))
    med_spend = float(np.median(spend_real))
    # Lifetime effective tax rate: total tax / total gross income, per path, then
    # the median. The honest "what share of everything I earned went to tax"
    # number — far below the marginal rate, and the headline hero alongside it.
    effective_rate = 0.0
    if result.gross_income is not None:
        income_real = (result.gross_income / deflate).sum(axis=1)
        rate = np.divide(tax_real, income_real,
                         out=np.zeros_like(tax_real), where=income_real > 1.0)
        effective_rate = float(np.median(rate))
    return {
        "median_real": med_tax,
        "as_pct_of_spending": (med_tax / med_spend) if med_spend > 0 else 0.0,
        "effective_rate": effective_rate,
    }
