"""Summary metrics computed from SimResult: percentile fans, success
probabilities, the success-vs-retirement-age sweep, FIRE/Coast numbers, the
accessibility series, and the Roth ladder schedule."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from .accounts import PENALTY_FREE_AGE
from .engine import SimResult, run
from .sampling import MarketPaths, sample_paths
from .scenario import (
    Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock,
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


def bridge_analysis(result: SimResult) -> dict:
    """Liquidity diagnostics for the bridge — early retirement to the 59½ penalty-
    free age (modeled as 60). The headline success rate blends the bridge crunch
    with late-life longevity risk; this isolates the two and sizes the early-
    withdrawal-penalty leakage within the bridge (itself a failure globally — see
    engine fail predicate). Every window is over ages < 60.

    Rides every /simulate:
      - bridge_break_rate: paths whose penalty-free money proved insufficient before
        60 — a hard shortfall OR a forced penalized traditional draw.
      - bridge_fail_rate / longevity_fail_rate: failures split by when they strike.
      - early_penalty_rate / median_penalty_real: how often, and how much, the plan
        leans on the 10% last-resort early withdrawal.
      - coverage / runway: conservative (growth-free) ratio of penalty-free assets
        on entering retirement to the spending the bridge demands — a floor.
      - min_accessible_real: per-path low-water mark of penalty-free assets (hist).
      - at_retirement: median accessible-vs-penalty-locked split of the portfolio.
    """
    ages = result.ages
    retire_age = int(result.scenario.retirement_age)
    pf_age = PENALTY_FREE_AGE
    P = int(result.fail.shape[0])
    bridge_cols = np.where((ages >= retire_age) & (ages < pf_age))[0]
    has_bridge = bool(retire_age < pf_age and bridge_cols.size > 0)

    out: dict = {
        "has_bridge": has_bridge,
        "bridge_start_age": retire_age,
        "bridge_end_age": pf_age,
        "bridge_years": max(pf_age - retire_age, 0),
        "total_paths": P,
    }
    if not has_bridge:
        return out

    # --- failure split: bridge liquidity crunch vs late-life longevity shortfall.
    # Use the HARD shortfall signal (spending went unfunded), not result.fail — the
    # global fail flag now also counts early-penalty reliance as failure, but this
    # split must keep "ran dry" distinct from "leaned on the penalty" (captured by
    # paid_penalty below; bridge_break re-unites them).
    hard_fail = (result.shortfall > 1.0) if result.shortfall is not None else result.fail
    failed_any = hard_fail.any(axis=1)
    bridge_fail = hard_fail[:, bridge_cols].any(axis=1)
    longevity_fail = failed_any & ~bridge_fail

    # --- early-penalty leakage (the cost a binary "success" hides)
    deflate = _flow_deflator(result)  # penalty & need are flows
    penalty = (result.penalty_paid if result.penalty_paid is not None
               else np.zeros_like(result.taxes_paid))
    per_path_penalty = (penalty / deflate)[:, bridge_cols].sum(axis=1)
    paid_penalty = per_path_penalty > 1.0
    n_penalty = int(paid_penalty.sum())

    # a path "breaks" the bridge if penalty-free money was insufficient by either
    # symptom — a hard shortfall, or a last-resort penalized draw
    bridge_break = bridge_fail | paid_penalty

    # --- conservative coverage / runway (ignores growth on the bridge → a floor)
    acc_total = sum(result.accessible.values()) / result.cum_inflation[:, 1:]  # (P,T) real
    t0 = int(bridge_cols[0])
    resources = acc_total[:, t0]  # penalty-free assets just inside retirement
    need_real = ((result.spending_need if result.spending_need is not None
                  else result.expenses) / deflate)
    bridge_need = need_real[:, bridge_cols].sum(axis=1)
    first_need = need_real[:, t0]
    coverage = np.clip(np.divide(resources, bridge_need,
                                 out=np.full(P, 20.0), where=bridge_need > 1.0), 0.0, 20.0)
    runway = np.clip(np.divide(resources, first_need,
                               out=np.full(P, 40.0), where=first_need > 1.0), 0.0, 40.0)
    min_accessible = acc_total[:, bridge_cols].min(axis=1)

    # --- accessible vs penalty-locked split of the portfolio entering retirement
    # (accessible[:, t] is recorded end-of-year, aligning with pools[:, t+1])
    pools_total = sum(p[:, t0 + 1] for p in result.pools.values()) / result.cum_inflation[:, t0 + 1]
    locked = np.maximum(pools_total - resources, 0.0)

    # --- bridge funding plan: the liquid pile you must hold to cover the first
    # retirement years BEFORE a retirement-start Roth conversion seasons (5 yrs).
    # Total real spending need over that window, and what the sim actually draws
    # from each penalty-free liquid source to meet it — the concrete "how much do
    # I need in cash / taxable / Roth basis" answer the coverage ratio only hints at.
    fund_cols = bridge_cols[:min(5, bridge_cols.size)]
    funding_total = float(np.median(need_real[:, fund_cols].sum(axis=1)))
    funding_by_source = {}
    for src in ("cash", "taxable", "roth_basis"):
        arr = (result.withdrawals or {}).get(src)
        funding_by_source[src] = (
            float(np.median((arr / deflate)[:, fund_cols].sum(axis=1)))
            if arr is not None else 0.0)

    out.update({
        "bridge_fail_rate": float(bridge_fail.mean()),
        "longevity_fail_rate": float(longevity_fail.mean()),
        "bridge_break_rate": float(bridge_break.mean()),
        "early_penalty_rate": float(paid_penalty.mean()),
        "early_penalty_paths": n_penalty,
        "median_penalty_real": float(np.median(per_path_penalty[paid_penalty])) if n_penalty else 0.0,
        "coverage_p5": float(np.percentile(coverage, 5)),
        "coverage_p25": float(np.percentile(coverage, 25)),
        "coverage_p50": float(np.percentile(coverage, 50)),
        "runway_p5": float(np.percentile(runway, 5)),
        "runway_p50": float(np.percentile(runway, 50)),
        "resources_p50_real": float(np.median(resources)),
        "need_p50_real": float(np.median(bridge_need)),
        "bridge_funding_years": int(fund_cols.size),
        "bridge_funding_total_real": funding_total,
        "bridge_funding_by_source": funding_by_source,
        "min_accessible_real": min_accessible.tolist(),
        "at_retirement": {
            "accessible_real": float(np.median(resources)),
            "locked_real": float(np.median(locked)),
            "pct_accessible": float(np.median(np.divide(
                resources, pools_total, out=np.zeros(P), where=pools_total > 1.0))),
        },
    })
    return out


def ladder_schedule(result: SimResult) -> list[dict]:
    """Median Roth conversion per year (real), with maturation year and the
    traditional pool still left after that year's conversion. Conversions are
    capped per path by the traditional balance (401k assumed rolled into an
    IRA once you leave work, so the pools merge)."""
    deflate = _flow_deflator(result)  # conversions are a flow
    med = np.median(result.conversions / deflate, axis=0)
    trad = result.pools["trad"]
    mrate = result.conversion_marginal_rate
    # per-year diagnostics that contextualize each conversion:
    #  - conv_tax: the added tax the conversion itself creates (the cash cost to
    #    convert; the conversion amount itself is an internal transfer, not a cost).
    #  - accessible_left: penalty-free balance at year end (today's $) — the liquid
    #    cushion behind the year; it draws down through the bridge and falls faster
    #    the more aggressively you convert (the conversion tax is funded from it).
    conv_tax = result.conversion_tax
    conv_tax_real = (np.median(conv_tax / deflate, axis=0) if conv_tax is not None else None)
    acc_left = (np.median(sum(result.accessible.values()) / result.cum_inflation[:, 1:], axis=0)
                if result.accessible else None)
    erate = result.effective_rate
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
                "effective_rate": float(np.median(erate[:, i])) if erate is not None else 0.0,
                "conversion_tax_real": float(conv_tax_real[i]) if conv_tax_real is not None else 0.0,
                "accessible_left_real": float(acc_left[i]) if acc_left is not None else 0.0,
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


def income_stress(scenario: Scenario, shock_age: int, duration: float,
                  n_paths: int = 2000) -> dict:
    """Success if wages drop to zero for a window of years (job loss / the
    'AI replaces my role' scenario), re-run on the SAME market paths so the
    delta is pure income effect, not sampling noise.

    `duration` may be fractional (e.g. 1.5 years, or 0.5 ≈ six months). The
    engine runs on an annual grain, so a fractional tail is approximated by
    earning only the non-shocked fraction of salary in the final partial year
    rather than a literal sub-year shock."""
    base_paths = sample_paths(scenario, n_paths=n_paths)
    base = run(scenario, paths=base_paths).success_rate
    s = scenario.model_copy(deep=True)
    full_salary = scenario.income.gross_salary
    horizon = scenario.profile.horizon_age
    s.events.append(Event(kind=EventKind.regime_change, age=shock_age,
                          name="Income Shock", overrides=RegimeOverrides(gross_salary=0.0)))
    full_years = int(duration)
    frac = duration - full_years
    if frac > 1e-9 and shock_age + full_years <= horizon:
        # final partial year: only the non-shocked share of the year is earned
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
    stressed = run(s, paths=base_paths).success_rate
    return {"base_success": base, "stressed_success": stressed,
            "delta": stressed - base, "shock_age": shock_age, "duration": duration}


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
            result.expenses / _flow_deflator(result), axis=0).tolist(),
        "spending_mult_median": np.median(result.spending_mult, axis=0).tolist(),
        "spending_mult_fan": spending_mult_fan(result),
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
        "ages": result.ages.tolist(),
        "years": result.years.tolist(),
        "sweep": sweep,
    }
