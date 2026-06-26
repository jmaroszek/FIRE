"""Bridge diagnostics: coverage analysis, Roth ladder & RMD schedules."""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from ..constants import FIRE_MULTIPLE, PENALTY_FREE_AGE
from ..engine import SimResult, run
from ..sampling import MarketPaths, sample_paths
from ..scenario import Event, EventKind, RegimeOverrides, Scenario, TaxRegimeShock
from .common import DEFAULT_PERCENTILES, _flow_deflator, percentile_fan


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
    tax_real = result.taxes_paid / deflate
    bridge_need = need_real[:, bridge_cols].sum(axis=1)
    first_need = need_real[:, t0]
    # Coverage is liquidity vs everything the bridge actually costs — not just
    # spending, but the income, Roth-conversion, and capital-gains tax those years
    # realize, paid from the same penalty-free accounts. (runway stays a pure
    # "years of spending" read, so it keeps the spending-only denominator.)
    bridge_cost = bridge_need + tax_real[:, bridge_cols].sum(axis=1)
    coverage = np.clip(np.divide(resources, bridge_cost,
                                 out=np.full(P, 20.0), where=bridge_cost > 1.0), 0.0, 20.0)
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
    # The liquid you must hold also has to cover the income, conversion, and
    # capital-gains tax those early years trigger (paid from the same accounts),
    # not just the spending — so fold the realized tax over the window in.
    fund_cols = bridge_cols[:min(5, bridge_cols.size)]
    funding_spend = need_real[:, fund_cols].sum(axis=1)
    funding_tax = tax_real[:, fund_cols].sum(axis=1)
    funding_total = float(np.median(funding_spend + funding_tax))
    funding_tax_total = float(np.median(funding_tax))
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
        "bridge_funding_tax_real": funding_tax_total,
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
