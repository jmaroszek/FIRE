"""Estimate the Social Security PIA (monthly benefit at full retirement age)
from a planned covered-earnings history.

SSA computes your Primary Insurance Amount from your 35 highest years of
Social-Security-covered earnings: average them into the AIME (Average Indexed
Monthly Earnings), then apply a progressive bend-point formula. An ssa.gov
projection assumes you keep earning until FRA — so for someone retiring early
it overstates the benefit, because the real record has many $0 years once the
paycheck stops. This module instead builds the record from the *plan's* earnings
(salary path + Social-Security-covered side income + any recorded/prior years),
so those zero years are counted. That zero-fill is the dominant correction for
an early retiree.

Everything is in today's dollars. We approximate SSA's wage indexing by
assuming the national Average Wage Index grows with inflation, which lets a
today's-$ earnings record map directly onto today's-$ bend points and the
taxable maximum. This is slightly conservative if real wages rise faster than
prices. The record is an individual one (single filer); spousal/survivor
benefits, WEP/GPO, and non-covered pensions are out of scope. See
docs/ASSUMPTIONS.md.
"""
from __future__ import annotations

from .scenario import Scenario

# Calibrated to 2025 SSA figures; bump yearly like the tax tables.
SS_TAXABLE_MAX = 176_100.0            # contribution & benefit base, today's $
SS_BEND_POINTS = (1_226.0, 7_391.0)   # monthly AIME bend points, today's $
SS_AIME_YEARS = 35                    # number of highest-earning years averaged


def pia_from_aime(aime: float) -> float:
    """Monthly PIA (today's $) from the AIME via the 90/32/15 bend-point formula."""
    b1, b2 = SS_BEND_POINTS
    pia = 0.90 * min(aime, b1)
    if aime > b1:
        pia += 0.32 * (min(aime, b2) - b1)
    if aime > b2:
        pia += 0.15 * (aime - b2)
    return pia


def aime_from_earnings(earnings_by_age: dict[int, float]) -> float:
    """AIME (today's $) = the SS_AIME_YEARS highest annual earnings (each capped
    at the taxable maximum) summed and spread over that many years of months.
    Fewer than SS_AIME_YEARS working years means the average is divided by the
    full window anyway — the zero-fill that pulls an early retiree's benefit down.
    """
    capped = sorted(
        (min(e, SS_TAXABLE_MAX) for e in earnings_by_age.values() if e > 0),
        reverse=True,
    )
    top = capped[:SS_AIME_YEARS]
    return sum(top) / (SS_AIME_YEARS * 12)


def estimate_monthly_at_fra(earnings_by_age: dict[int, float]) -> float:
    """Convenience: PIA (today's $/month at FRA) straight from an earnings record."""
    return pia_from_aime(aime_from_earnings(earnings_by_age))


def covered_earnings_by_age(
    scenario: Scenario, primary_salary_real: list[float]
) -> dict[int, float]:
    """Today's-$ Social-Security-covered earnings per age, layering three sources
    (highest priority wins):

      1. recorded earnings  — actuals the user logged (e.g. from snapshots),
         already in today's $; override everything for their age.
      2. prior history      — a flat `prior_avg_earnings` filling the years from
         `work_start_age` up to the plan's start age that aren't already recorded.
      3. modeled wages      — the plan's primary salary path (`primary_salary_real`,
         which the engine already zeroes at retirement) plus any income streams
         flagged `ss_covered`, for the simulated years.

    `primary_salary_real` is the per-sim-year real salary from the engine's
    precomputed regimes, so salary regime-events (raises, barista FIRE) are
    already reflected.
    """
    start_age = scenario.start_age
    ss = scenario.social_security
    earnings: dict[int, float] = {}

    # 3a. modeled primary salary (already zero once retired)
    for t, sal in enumerate(primary_salary_real):
        if sal > 0:
            age = start_age + t
            earnings[age] = earnings.get(age, 0.0) + sal

    # 3b. Social-Security-covered secondary income streams (own wages / self-
    # employment). Side income can run past retirement (barista FIRE) and still
    # earns covered credits, so it is counted wherever the stream is active.
    mean_infl = scenario.inflation.mean
    for stream in scenario.income_streams:
        if not getattr(stream, "ss_covered", False):
            continue
        g = stream.effective_real_growth(mean_infl)
        s_age = stream.start_age if stream.start_age is not None else start_age
        e_age = stream.end_age if stream.end_age is not None else scenario.profile.horizon_age
        for age in range(s_age, e_age + 1):
            val = stream.annual * (1 + g) ** max(age - s_age, 0)
            earnings[age] = earnings.get(age, 0.0) + val

    # 2. prior history fills only the years it doesn't already know about
    if ss.work_start_age is not None and ss.prior_avg_earnings > 0:
        for age in range(ss.work_start_age, start_age):
            earnings.setdefault(age, ss.prior_avg_earnings)

    # 1. recorded actuals override their age outright
    for age, val in ss.recorded_earnings.items():
        earnings[int(age)] = val

    return earnings


def estimate_pia(scenario: Scenario, primary_salary_real: list[float]) -> float:
    """End-to-end estimate of `monthly_at_fra` (today's $) for a scenario."""
    return estimate_monthly_at_fra(covered_earnings_by_age(scenario, primary_salary_real))
