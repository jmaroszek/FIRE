"""Stress tests: income shock, bridge crash, tax-regime sunset, ladder savings."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan
from .bridge import bridge_analysis
from .success import retirement_sweep, years_to_fi


def _with_income_shock(scenario: Scenario, shock_age: int, duration: float) -> Scenario:
    """A copy of `scenario` with wages zeroed for `duration` years from `shock_age`
    (a job loss / 'AI replaces my role' window), as regime-change events.

    `duration` may be fractional (e.g. 1.5 years, or 0.5 ≈ six months). The engine
    runs on an annual grain, so a fractional tail is approximated by earning only
    the non-shocked fraction of salary in the final partial year. Shared by the
    success comparison and the earliest-retirement-age readout."""
    s = scenario.model_copy(deep=True)
    full_salary = scenario.income.gross_salary
    horizon = scenario.profile.horizon_age
    s.events.append(Event(kind=EventKind.regime_change, age=shock_age,
                          name="Income Shock", overrides=RegimeOverrides(gross_salary=0.0)))
    full_years = int(duration)
    frac = duration - full_years
    if frac > 1e-9 and shock_age + full_years <= horizon:
        s.events.append(Event(kind=EventKind.regime_change, age=shock_age + full_years,
                              name="Partial Income",
                              overrides=RegimeOverrides(gross_salary=(1.0 - frac) * full_salary)))
        restore_age = shock_age + full_years + 1
    else:
        restore_age = shock_age + full_years
    if restore_age <= horizon:
        s.events.append(Event(kind=EventKind.regime_change, age=restore_age,
                              name="Income Restored",
                              overrides=RegimeOverrides(gross_salary=full_salary)))
    return s


def income_stress(scenario: Scenario, shock_age: int, duration: float,
                  n_paths: int = 2000) -> dict:
    """Success if wages drop to zero for a window of years, re-run on the SAME
    market paths so the delta is pure income effect, not sampling noise."""
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths).success_rate
    s = _with_income_shock(scenario, shock_age, duration)
    stressed = run(s, paths=base_paths).success_rate
    return {"base_success": base, "stressed_success": stressed,
            "delta": stressed - base, "shock_age": shock_age, "duration": duration}


def income_stress_earliest(scenario: Scenario, shock_age: int, duration: float,
                           n_paths: int = 800) -> dict:
    """Earliest retirement age that clears the success threshold (and stays above
    it), baseline vs under the income shock — the When-Can-I-Retire answer recomputed
    with wages zeroed over the shock window. None = no age through 70 clears it.

    Losing income can only push the earliest age later, never earlier (with shared
    seeded paths, stressed success <= baseline at every age), so the stressed sweep
    only needs to consider ages at/above the baseline earliest age. And if the
    baseline plan never clears the threshold, the shocked one can't either — the
    stressed sweep is skipped entirely. Both shortcuts cut the work materially."""
    threshold = scenario.sim.success_threshold
    start_age = scenario.start_age
    base_sweep = retirement_sweep(scenario, n_paths=n_paths)
    base_yf = years_to_fi(base_sweep, threshold, start_age)
    base_earliest = (start_age + base_yf) if base_yf is not None else None

    stressed_earliest = None
    if base_earliest is not None:
        # the shocked answer lives in [base_earliest, 70]; sweeping below it is wasted.
        stressed_sweep = retirement_sweep(
            _with_income_shock(scenario, shock_age, duration),
            ages=list(range(base_earliest, 71)), n_paths=n_paths)
        stressed_yf = years_to_fi(stressed_sweep, threshold, start_age)
        stressed_earliest = (start_age + stressed_yf) if stressed_yf is not None else None

    return {
        "base_earliest_age": base_earliest,
        "stressed_earliest_age": stressed_earliest,
        "shock_age": shock_age,
        "duration": duration,
        "threshold": threshold,
        "horizon_age": scenario.profile.horizon_age,
    }


def bridge_crash_stress(scenario: Scenario, drop: float = 0.30, years: int = 2,
                        n_paths: int = 2000) -> dict:
    """Retire-into-a-crash: force a market drop in the FIRST `years` years of
    retirement on the SAME sampled paths, so the delta is pure sequence risk. A
    severe drawdown right at the start of the bridge is the early retiree's worst
    case — spending sells depressed assets exactly when the penalty-free runway has
    the longest way to go. Reports the hit to overall success AND to the bridge-
    specific break and early-penalty rates."""
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths)
    t_retire = max(scenario.retirement_age - scenario.start_age, 0)
    end = min(t_retire + max(years, 1), base_paths.n_years)
    stock = base_paths.stock.copy()
    bond = base_paths.bond.copy()
    # a crash REPLACES those years' returns (same convention as crash events):
    # stocks take the full drop, bonds a third of it (flight-to-quality cushion).
    stock[:, t_retire:end] = -drop
    bond[:, t_retire:end] = -drop / 3.0
    stressed = run(scenario, paths=replace(base_paths, stock=stock, bond=bond))

    bb, sb = bridge_analysis(base), bridge_analysis(stressed)
    return {
        "has_bridge": bb["has_bridge"],
        "drop": drop,
        "years": end - t_retire,
        "retirement_age": scenario.retirement_age,
        "base_success": base.success_rate,
        "stressed_success": stressed.success_rate,
        "success_delta": stressed.success_rate - base.success_rate,
        "base_bridge_break_rate": bb.get("bridge_break_rate", 0.0),
        "stressed_bridge_break_rate": sb.get("bridge_break_rate", 0.0),
        "base_early_penalty_rate": bb.get("early_penalty_rate", 0.0),
        "stressed_early_penalty_rate": sb.get("early_penalty_rate", 0.0),
    }


def tax_regime_stress(scenario: Scenario, sunset_age: int, bracket_rate_mult: float = 1.15,
                      std_deduction_mult: float = 0.5, n_paths: int = 2000) -> dict:
    """Re-run the plan as if today's tax law reverts at `sunset_age` — ordinary
    brackets scaled up, the standard deduction cut — on the SAME market paths. This
    is the TCJA-style policy risk the entire low-bracket Roth-ladder thesis is
    implicitly betting against; it reports both the hit to success and the rise in
    lifetime real tax. The multipliers are a documented approximation of a reversion,
    not an exact pre-2018 bracket table."""
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths)
    shock = TaxRegimeShock(sunset_age=sunset_age, bracket_rate_mult=bracket_rate_mult,
                           std_deduction_mult=std_deduction_mult)
    stressed = run(scenario, paths=base_paths, tax_regime=shock)

    def life_tax(r) -> float:
        return float(np.median((r.taxes_paid / _flow_deflator(r)).sum(axis=1)))

    return {
        "base_success": base.success_rate,
        "stressed_success": stressed.success_rate,
        "delta": stressed.success_rate - base.success_rate,
        "base_lifetime_tax_real": life_tax(base),
        "stressed_lifetime_tax_real": life_tax(stressed),
        "sunset_age": sunset_age,
        "bracket_rate_mult": bracket_rate_mult,
        "std_deduction_mult": std_deduction_mult,
    }


def ladder_tax_savings(scenario: Scenario, n_paths: int = 1000) -> dict:
    """Lifetime real tax with the Roth conversion ladder as configured vs with no
    conversions at all, on one shared set of market paths — the scoreboard for the
    whole ladder strategy in a single dollar figure. Positive `saved_real` means
    the ladder lowers lifetime tax (the usual case: convert cheaply in low-bracket
    bridge years instead of facing RMDs at a higher rate later)."""
    paths = sample_paths(scenario, n_paths=n_paths)

    def life_tax(s: Scenario) -> float:
        r = run(s, paths=paths)
        return float(np.median((r.taxes_paid / _flow_deflator(r)).sum(axis=1)))

    with_ladder = life_tax(scenario)
    s0 = scenario.model_copy(deep=True)
    s0.conversion_rule.kind = "none"
    without_ladder = life_tax(s0)
    return {
        "with_ladder_real": with_ladder,
        "without_ladder_real": without_ladder,
        "saved_real": without_ladder - with_ladder,
    }
