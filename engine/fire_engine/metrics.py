"""Summary metrics computed from SimResult: percentile fans, success
probabilities, the success-vs-retirement-age sweep, FIRE/Coast numbers, the
accessibility series, and the Roth ladder schedule."""

from __future__ import annotations

import numpy as np

from .engine import SimResult, run
from .sampling import MarketPaths, sample_paths
from .scenario import (
    AccountType, Event, EventKind, RegimeOverrides, Scenario, WaterfallStep,
)

DEFAULT_PERCENTILES = (5, 25, 50, 75, 95)


def _flow_deflator(result: SimResult) -> np.ndarray:
    """Deflator for year-t *flows* (taxes, expenses, contributions, conversions).

    The engine computes flows at start-of-year prices, cum_inflation[:, t], so
    they convert back to today's dollars with column t — i.e. cum_inflation[:, :-1].
    End-of-year *stocks* (net worth, pools, accessibility) deflate with [:, 1:].
    Using [:, 1:] for a flow over-deflates it by one year of inflation (~2%),
    which is why a contribution pinned to its IRS cap showed up just under it."""
    return result.cum_inflation[:, :-1]


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
    """Median Roth conversion per year (real), with maturation year and the
    traditional pool still left after that year's conversion. Conversions are
    capped per path by the traditional balance (401k assumed rolled into an
    IRA once you leave work, so the pools merge)."""
    deflate = _flow_deflator(result)  # conversions are a flow
    med = np.median(result.conversions / deflate, axis=0)
    trad = result.pools["trad"]
    mrate = result.conversion_marginal_rate
    out = []
    for i, amount in enumerate(med):
        if amount > 1.0:
            trad_left = float(np.median(
                trad[:, i + 1] / result.cum_inflation[:, i + 1]))
            out.append({
                "year": int(result.years[i]),
                "age": int(result.ages[i]),
                "amount_real": float(amount),
                "matures": int(result.years[i]) + 5,
                "trad_remaining_real": trad_left,
                # marginal tax rate the NEXT conversion dollar would face (median
                # path) — bracket + SS torpedo + LTCG displacement
                "marginal_rate": float(np.median(mrate[:, i])) if mrate is not None else 0.0,
            })
    return out


def rmd_schedule(result: SimResult) -> list[dict]:
    """Median required minimum distribution per year (real), the traditional pool
    feeding it, and the marginal tax rate on the next ordinary dollar that year —
    i.e. the bracket the RMD pushes you into. Diagnostic for how hard to ladder:
    if these RMDs land in a high bracket, convert more (lower) before 75."""
    if result.rmds is None:
        return []
    deflate = _flow_deflator(result)  # RMDs are a flow
    med = np.median(result.rmds / deflate, axis=0)
    trad = result.pools["trad"]
    mrate = result.conversion_marginal_rate
    out = []
    for i, amount in enumerate(med):
        if amount > 1.0:
            out.append({
                "year": int(result.years[i]),
                "age": int(result.ages[i]),
                "amount_real": float(amount),
                "trad_remaining_real": float(np.median(
                    trad[:, i + 1] / result.cum_inflation[:, i + 1])),
                "marginal_rate": float(np.median(mrate[:, i])) if mrate is not None else 0.0,
            })
    return out


def investing_medians_real(result: SimResult) -> dict[str, list[float]]:
    """Median annual contribution by destination, in today's dollars.
    'cash' includes unallocated surplus that pools in the cash account;
    'match' is the employer contribution."""
    deflate = _flow_deflator(result)  # contributions are a flow
    return {
        name: np.median(series / deflate, axis=0).tolist()
        for name, series in (result.contrib_pools or {}).items()
    }


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
    """Histogram of the age at which each failing path first runs short, plus the
    count that never failed. 'When do plans die?' is more actionable than a single
    success number."""
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


def sequence_scatter(result: SimResult, window: int = 5) -> dict:
    """Each path's mean REAL portfolio return over its first `window` years paired
    with its outcome (ending real wealth + survived flag). Visualizes sequence-of-
    returns risk: the first decade dominates a multi-decade horizon."""
    if result.port_return is None:
        return {"first_window_return": [], "ending_real": [], "survived": [], "window": window}
    infl = result.cum_inflation[:, 1:] / result.cum_inflation[:, :-1] - 1.0
    real_ret = (1 + result.port_return) / (1 + infl) - 1.0
    w = min(window, real_ret.shape[1])
    first = real_ret[:, :w].mean(axis=1)
    ending_real = result.net_worth[:, -1] / result.cum_inflation[:, -1]
    survived = ~result.fail.any(axis=1)
    return {
        "first_window_return": first.tolist(),
        "ending_real": ending_real.tolist(),
        "survived": survived.tolist(),
        "window": w,
    }


def success_ci(result: SimResult, z: float = 1.959963984540054) -> dict:
    """Wilson score interval on the success rate: the Monte-Carlo *sampling error*
    on the probability estimate given n_paths — NOT a confidence interval on the
    user's real-life outcome. Wilson (not normal-approx) because near 95%+ success
    the normal interval spills past 1.0."""
    n = int(result.fail.shape[0])
    k = int((~result.fail.any(axis=1)).sum())
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


# ---- on-demand decision-surface analyses (separate endpoints) -------------

def _retirement_living_expenses(scenario: Scenario, at_age: int) -> float:
    """Non-medical expense streams active at an age — the slice spending_scale
    flexes (medical and loan payments are held fixed)."""
    return sum(
        s.annual for s in scenario.expense_streams
        if not s.is_medical
        and (s.start_age is None or s.start_age <= at_age)
        and (s.end_age is None or s.end_age >= at_age)
    )


def max_sustainable_spend(scenario: Scenario, n_paths: int = 1000,
                          tolerance: float = 0.01) -> dict:
    """Largest spending_scale on living expenses that still meets the success
    threshold, by bisection over one shared set of market paths. The inverse of
    the FIRE number: 'how much can I spend?' instead of 'how much do I need?'."""
    threshold = scenario.sim.success_threshold
    paths = sample_paths(scenario, n_paths=n_paths)

    def ok(scale: float) -> bool:
        return run(scenario, paths=paths, spending_scale=scale).success_rate >= threshold

    lo, hi = 0.0, 1.0
    capped = False
    if ok(hi):
        while ok(hi) and hi < 8.0:
            lo, hi = hi, hi * 2
        if hi >= 8.0 and ok(hi):
            lo, capped = hi, True
    # invariant when not capped: ok(lo), not ok(hi)
    if not capped:
        while hi - lo > tolerance:
            mid = (lo + hi) / 2
            if ok(mid):
                lo = mid
            else:
                hi = mid
    base_living = _retirement_living_expenses(scenario, scenario.retirement_age)
    return {
        "max_scale": lo,
        "base_living_annual": base_living,
        "max_living_annual": lo * base_living,
        "threshold": threshold,
        "capped": capped,
    }


def success_surface(scenario: Scenario, ages: list[int] | None = None,
                    spending_scales: list[float] | None = None,
                    n_paths: int = 800) -> dict:
    """Success rate over a (retirement age × spending scale) grid, reusing one
    set of market paths across every cell. The whole when-and-how-much frontier
    at a glance."""
    start_age = scenario.start_age
    if ages is None:
        ages = list(range(max(start_age, 40), 68, 2))
    if spending_scales is None:
        spending_scales = [round(0.8 + 0.1 * i, 2) for i in range(7)]  # 0.8 .. 1.4
    paths = sample_paths(scenario, n_paths=n_paths)
    matrix = [
        [run(scenario, paths=paths, retirement_age=a, spending_scale=sc).success_rate
         for a in ages]
        for sc in spending_scales
    ]
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
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths).success_rate
    lo_f, hi_f = 1 - delta, 1 + delta
    pct = f"{int(round(delta * 100))}%"

    def entry(param, low_label, low_s, high_label, high_s):
        return {"param": param, "low_label": low_label, "low_success": low_s,
                "high_label": high_label, "high_success": high_s, "base_success": base}

    out = [
        entry("Spending Level", f"−{pct}",
              run(scenario, paths=base_paths, spending_scale=lo_f).success_rate,
              f"+{pct}", run(scenario, paths=base_paths, spending_scale=hi_f).success_rate),
        entry("Retirement Age", "−2 yr",
              run(scenario, paths=base_paths, retirement_age=scenario.retirement_age - 2).success_rate,
              "+2 yr", run(scenario, paths=base_paths, retirement_age=scenario.retirement_age + 2).success_rate),
        entry("Starting Balances", f"−{pct}",
              run(scenario, paths=base_paths, balance_scale=lo_f).success_rate,
              f"+{pct}", run(scenario, paths=base_paths, balance_scale=hi_f).success_rate),
    ]
    for param, field in (("Stock Return", "stock_cagr"), ("Stock Volatility", "stock_vol"),
                         ("Bond Return", "bond_cagr"), ("Inflation", "infl_mean")):
        s_lo, s_hi = _market_perturbed(scenario, field, lo_f), _market_perturbed(scenario, field, hi_f)
        out.append(entry(
            param, f"−{pct}", run(s_lo, paths=sample_paths(s_lo, n_paths=n_paths)).success_rate,
            f"+{pct}", run(s_hi, paths=sample_paths(s_hi, n_paths=n_paths)).success_rate))
    out.sort(key=lambda e: abs(e["high_success"] - e["low_success"]), reverse=True)
    return {"base_success": base, "entries": out, "delta": delta}


def income_stress(scenario: Scenario, shock_age: int, duration: int,
                  n_paths: int = 2000) -> dict:
    """Success if wages drop to zero for a window of years (job loss / the
    'AI replaces my role' scenario), re-run on the SAME market paths so the
    delta is pure income effect, not sampling noise."""
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths).success_rate
    s = scenario.model_copy(deep=True)
    s.events.append(Event(kind=EventKind.regime_change, age=shock_age,
                          name="Income Shock", overrides=RegimeOverrides(gross_salary=0.0)))
    if shock_age + duration <= scenario.profile.horizon_age:
        s.events.append(Event(kind=EventKind.regime_change, age=shock_age + duration,
                              name="Income Restored",
                              overrides=RegimeOverrides(gross_salary=scenario.income.gross_salary)))
    stressed = run(s, paths=base_paths).success_rate
    return {"base_success": base, "stressed_success": stressed,
            "delta": stressed - base, "shock_age": shock_age, "duration": duration}


def _contribution_waterfall(kind: str) -> list[WaterfallStep]:
    """Two contribution orderings that differ only in whether tax-advantaged
    savings go pre-tax (traditional) or post-tax (Roth). Both still grab the
    employer match first and fund the HSA."""
    head = [WaterfallStep(account=AccountType.trad_401k, kind="to_match"),
            WaterfallStep(account=AccountType.hsa, kind="max")]
    if kind == "trad":
        body = [WaterfallStep(account=AccountType.trad_ira, kind="max"),
                WaterfallStep(account=AccountType.trad_401k, kind="max")]
    else:
        body = [WaterfallStep(account=AccountType.roth_ira, kind="max"),
                WaterfallStep(account=AccountType.roth_401k, kind="max")]
    return head + body + [WaterfallStep(account=AccountType.taxable, kind="max")]


def roth_vs_trad(scenario: Scenario, n_paths: int = 1000) -> dict:
    """Accumulation-phase mirror of the conversion ladder: route tax-advantaged
    contributions pre-tax (traditional) vs post-tax (Roth) and compare lifetime
    tax, success, and ending wealth on one shared set of market paths."""
    paths = sample_paths(scenario, n_paths=n_paths)

    def variant(kind: str) -> dict:
        s = scenario.model_copy(deep=True)
        s.waterfall = _contribution_waterfall(kind)
        r = run(s, paths=paths)
        lifetime_tax = float(np.median((r.taxes_paid / _flow_deflator(r)).sum(axis=1)))
        ending = float(np.median(r.net_worth[:, -1] / r.cum_inflation[:, -1]))
        return {"success_rate": r.success_rate,
                "lifetime_tax_real": lifetime_tax, "ending_real": ending}

    trad, roth = variant("trad"), variant("roth")
    return {
        "trad": trad, "roth": roth,
        "success_diff": roth["success_rate"] - trad["success_rate"],
        "tax_diff": roth["lifetime_tax_real"] - trad["lifetime_tax_real"],
        "ending_diff": roth["ending_real"] - trad["ending_real"],
    }


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
        "rmd_schedule": rmd_schedule(result),
        "taxes_median_real": np.median(
            result.taxes_paid / _flow_deflator(result), axis=0).tolist(),
        "expenses_median_real": np.median(
            result.expenses / _flow_deflator(result), axis=0).tolist(),
        "spending_mult_median": np.median(result.spending_mult, axis=0).tolist(),
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
        "ages": result.ages.tolist(),
        "years": result.years.tolist(),
        "sweep": sweep,
    }
