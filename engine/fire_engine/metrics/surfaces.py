"""Decision surfaces: max sustainable spend, success surface, sensitivity tornado."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan


def _retirement_living_expenses(scenario: Scenario, at_age: int) -> float:
    """Non-medical expense streams active at an age — the slice spending_scale
    flexes (medical and loan payments are held fixed)."""
    return sum(
        s.annual for s in scenario.expense_streams
        if not s.is_medical
        and (s.start_age is None or s.start_age <= at_age)
        and (s.end_age is None or s.end_age >= at_age)
    )


def _bisect_max_scale(ok, tolerance: float = 0.01) -> tuple[float, bool]:
    """Largest scale for which ok(scale) holds, by bisection. Returns
    (scale, capped) where capped means the search hit the 8× ceiling."""
    lo, hi = 0.0, 1.0
    capped = False
    if ok(hi):
        while ok(hi) and hi < 8.0:
            lo, hi = hi, hi * 2
        if hi >= 8.0 and ok(hi):
            return hi, True
    # invariant when not capped: ok(lo), not ok(hi)
    while hi - lo > tolerance:
        mid = (lo + hi) / 2
        if ok(mid):
            lo = mid
        else:
            hi = mid
    return lo, capped


def max_sustainable_spend(scenario: Scenario, n_paths: int = 1000,
                          tolerance: float = 0.01) -> dict:
    """Largest spending_scale on living expenses that still meets the success
    threshold, by bisection over one shared set of market paths. The inverse of
    the FIRE number: 'how much can I spend?' instead of 'how much do I need?'.

    Two answers, sharing the path set: `max_scale` flexes living expenses across
    the WHOLE plan ('how much can I afford to live on now while still retiring on
    time'); `retirement_max_scale` flexes only retirement-and-later expenses ('how
    much can I spend each year IN retirement'). Both honor the success threshold
    and the legacy floor (via run().success_rate)."""
    threshold = scenario.sim.success_threshold
    paths = sample_paths(scenario, n_paths=n_paths)

    def ok(scale: float) -> bool:
        return run(scenario, paths=paths, spending_scale=scale).success_rate >= threshold

    def ok_retire(scale: float) -> bool:
        return run(scenario, paths=paths, spending_scale=scale,
                   spending_scale_from_age=scenario.retirement_age).success_rate >= threshold

    max_scale, capped = _bisect_max_scale(ok, tolerance)
    retire_scale, retire_capped = _bisect_max_scale(ok_retire, tolerance)
    base_living = _retirement_living_expenses(scenario, scenario.retirement_age)
    return {
        "max_scale": max_scale,
        "base_living_annual": base_living,
        "max_living_annual": max_scale * base_living,
        "retirement_max_scale": retire_scale,
        "retirement_max_living_annual": retire_scale * base_living,
        "retirement_capped": retire_capped,
        "threshold": threshold,
        "capped": capped,
    }


def _tile_paths(paths: MarketPaths, k: int) -> MarketPaths:
    """Replicate a path set k times along the path axis (block layout: rows
    [i·P:(i+1)·P] are an identical copy of the base sample). Lets one run()
    evaluate k spending levels on a *shared* market sample — block i carries
    spending scale i, every block sees the same returns."""
    def tile(a: np.ndarray | None) -> np.ndarray | None:
        return None if a is None else np.tile(a, (k, 1))
    return MarketPaths(
        stock=tile(paths.stock), bond=tile(paths.bond), cash=tile(paths.cash),
        inflation=tile(paths.inflation), cum_inflation=tile(paths.cum_inflation),
        income_z=tile(paths.income_z),
    )


def success_surface(scenario: Scenario, ages: list[int] | None = None,
                    spending_scales: list[float] | None = None,
                    n_paths: int = 800) -> dict:
    """Success rate over a (retirement age × spending scale) grid, reusing one
    set of market paths across every cell. The whole when-and-how-much frontier
    at a glance.

    All spending scales for a given age are evaluated in a SINGLE run(): the
    shared path set is tiled k=len(spending_scales) times and each block is
    handed its own per-path spending scale. This collapses the grid from
    len(ages)·k engine runs to len(ages) — same shared-paths result as the
    per-cell loop, far fewer (GIL-bound) per-year passes."""
    start_age = scenario.start_age
    if ages is None:
        ages = list(range(max(start_age, 40), 68, 2))
    if spending_scales is None:
        spending_scales = [round(0.8 + 0.1 * i, 2) for i in range(5)]  # 0.8 .. 1.2
    base_paths = sample_paths(scenario, n_paths=n_paths)
    P = base_paths.n_paths
    k = len(spending_scales)
    tiled = _tile_paths(base_paths, k)
    scale_vec = np.repeat(np.asarray(spending_scales, dtype=float), P)  # block i -> scale i

    # matrix[i][j] = success at spending_scales[i], ages[j]
    matrix: list[list[float]] = [[0.0] * len(ages) for _ in range(k)]
    for j, a in enumerate(ages):
        r = run(scenario, paths=tiled, retirement_age=a, spending_scale=scale_vec)
        failed = r.fail.any(axis=1)
        if r.legacy_met is not None:
            failed = failed | ~r.legacy_met
        succ = 1.0 - failed.reshape(k, P).mean(axis=1)  # success per scale block
        for i in range(k):
            matrix[i][j] = float(succ[i])
    return {
        "ages": ages,
        "spending_scales": spending_scales,
        "matrix": matrix,  # rows = spending_scales, cols = ages
        "threshold": scenario.sim.success_threshold,
    }


def _market_perturbed(scenario: Scenario, field: str, factor: float) -> Scenario:
    s = scenario.model_copy(deep=True)
    if field == "stock_cagr":
        s.market.stocks.real_cagr *= factor
        s.market.bootstrap_mean_shift = True  # so the CAGR bites in bootstrap mode too
    elif field == "stock_vol":
        s.market.stocks.vol *= factor  # only bites in parametric mode (documented)
    elif field == "bond_cagr":
        s.market.bonds.real_cagr *= factor
        s.market.bootstrap_mean_shift = True
    elif field == "infl_mean":
        s.inflation.mean *= factor  # only bites in parametric mode (bootstrap uses historical)
    return s


def sensitivity_tornado(scenario: Scenario, n_paths: int = 2000,
                        delta: float = 0.10) -> dict:
    """One-at-a-time sensitivity of the success rate to each core input. Spending,
    retirement age, and balances reuse one shared path set; market/inflation
    perturbations resample (they change the paths themselves). Bars sorted by
    swing — the answer to 'which assumption should I sweat?'."""
    # The market-CAGR bars only "bite" in bootstrap mode when mean-shift is on
    # (otherwise raw history ignores the entered CAGRs), so _market_perturbed
    # forces it on. To keep the whole chart on ONE baseline, the base and every
    # other bar must honor that same setting — otherwise the mean-shift flip
    # re-centers returns and floats the market bars off the "base" line (a
    # zero-allocation asset would show a sliver offset from base instead of
    # collapsing onto it). Only matters in bootstrap mode; parametric is untouched.
    tscenario = scenario
    if scenario.market.mode == "bootstrap" and not scenario.market.bootstrap_mean_shift:
        tscenario = scenario.model_copy(deep=True)
        tscenario.market.bootstrap_mean_shift = True

    base_paths = sample_paths(tscenario, n_paths=n_paths)
    base = run(tscenario, paths=base_paths).success_rate
    lo_f, hi_f = 1 - delta, 1 + delta
    pct = f"{int(round(delta * 100))}%"

    def entry(param, low_label, low_s, high_label, high_s):
        return {"param": param, "low_label": low_label, "low_success": low_s,
                "high_label": high_label, "high_success": high_s, "base_success": base}

    out = [
        entry("Spending Level", f"−{pct}",
              run(tscenario, paths=base_paths, spending_scale=lo_f).success_rate,
              f"+{pct}", run(tscenario, paths=base_paths, spending_scale=hi_f).success_rate),
        entry("Retirement Age", "−2 yr",
              run(tscenario, paths=base_paths, retirement_age=tscenario.retirement_age - 2).success_rate,
              "+2 yr", run(tscenario, paths=base_paths, retirement_age=tscenario.retirement_age + 2).success_rate),
        entry("Starting Balances", f"−{pct}",
              run(tscenario, paths=base_paths, balance_scale=lo_f).success_rate,
              f"+{pct}", run(tscenario, paths=base_paths, balance_scale=hi_f).success_rate),
    ]
    for param, field in (("Stock Return", "stock_cagr"), ("Stock Volatility", "stock_vol"),
                         ("Bond Return", "bond_cagr"), ("Inflation", "infl_mean")):
        s_lo, s_hi = _market_perturbed(tscenario, field, lo_f), _market_perturbed(tscenario, field, hi_f)
        out.append(entry(
            param, f"−{pct}", run(s_lo, paths=sample_paths(s_lo, n_paths=n_paths)).success_rate,
            f"+{pct}", run(s_hi, paths=sample_paths(s_hi, n_paths=n_paths)).success_rate))
    out.sort(key=lambda e: abs(e["high_success"] - e["low_success"]), reverse=True)
    return {"base_success": base, "entries": out, "delta": delta}
