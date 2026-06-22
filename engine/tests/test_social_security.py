"""PIA estimation from a planned covered-earnings history (social_security.py).

The headline behavior under test: an early retiree's 35-year average includes
the post-retirement $0 years, so the estimate lands well below a work-until-FRA
projection. Also covers the bend-point math, the taxable-max cap, and the
three-layer earnings record (modeled wages / prior history / recorded actuals).
"""
import math

import pytest

from fire_engine import Scenario
from fire_engine.scenario import (
    Income,
    IncomeStream,
    Profile,
    SimSettings,
    SocialSecurity,
)
from fire_engine.social_security import (
    SS_BEND_POINTS,
    SS_TAXABLE_MAX,
    aime_from_earnings,
    covered_earnings_by_age,
    estimate_monthly_at_fra,
    estimate_pia,
    pia_from_aime,
)

B1, B2 = SS_BEND_POINTS


def test_pia_bend_points_each_tier():
    # below the first bend: 90% replacement
    assert pia_from_aime(1000) == pytest.approx(900.0)
    # between the bends: 90% of b1 + 32% of the rest
    assert pia_from_aime(5000) == pytest.approx(0.9 * B1 + 0.32 * (5000 - B1))
    # above the second bend: + 15% of the excess
    assert pia_from_aime(10000) == pytest.approx(
        0.9 * B1 + 0.32 * (B2 - B1) + 0.15 * (10000 - B2)
    )


def test_aime_divides_by_full_window_even_with_few_years():
    # 10 years at $84k -> averaged over 35 years (420 months), not 10
    earnings = {age: 84_000 for age in range(30, 40)}
    assert aime_from_earnings(earnings) == pytest.approx(840_000 / 420)


def test_aime_caps_each_year_at_taxable_max():
    earnings = {40: 300_000, 41: 50_000}  # first year well above the cap
    assert aime_from_earnings(earnings) == pytest.approx(
        (SS_TAXABLE_MAX + 50_000) / 420
    )


def test_aime_keeps_only_the_top_35_years():
    # 40 years: thirty-five at $100k, five at $10k — the low five drop out
    earnings = {age: 100_000 for age in range(25, 60)}        # 35 years
    earnings.update({age: 10_000 for age in range(60, 65)})   # 5 lean years
    assert aime_from_earnings(earnings) == pytest.approx(35 * 100_000 / 420)


def test_early_retiree_benefit_is_lower_than_full_career():
    """The whole point: retiring early leaves $0 years in the 35-year average."""
    full_career = {age: 100_000 for age in range(25, 60)}      # 35 covered years
    early_retire = {age: 100_000 for age in range(25, 40)}     # only 15 years
    pia_full = estimate_monthly_at_fra(full_career)
    pia_early = estimate_monthly_at_fra(early_retire)
    assert pia_early < pia_full
    # 15 of 35 years funded -> AIME (and the high tiers) collapse materially
    assert pia_early < 0.7 * pia_full


def _mini_scenario(**ss_kwargs) -> Scenario:
    # start_year 2026 - birth_year 1996 => start age 30; retire at 40, horizon 90
    return Scenario(
        profile=Profile(birth_year=1996, horizon_age=90),
        sim=SimSettings(start_year=2026),
        income=Income(gross_salary=80_000),
        retirement_age=40,
        social_security=SocialSecurity(benefit_mode="estimated", **ss_kwargs),
    )


# salary path the engine would precompute: $80k for ages 30-39, $0 once retired
SALARY_PATH = [80_000.0] * 10 + [0.0] * 51


def test_covered_earnings_layers_modeled_prior_and_recorded():
    scn = _mini_scenario(
        work_start_age=22,
        prior_avg_earnings=50_000,
        recorded_earnings={28: 60_000},
    )
    scn.income_streams = [
        IncomeStream(name="Bonus", annual=10_000, start_age=30, end_age=34,
                     growth_mode="real", real_growth=0.0, ss_covered=True),
        IncomeStream(name="Rental", annual=20_000, ss_covered=False),
    ]
    earned = covered_earnings_by_age(scn, SALARY_PATH)

    # modeled salary + covered bonus stack within the bonus window
    assert earned[30] == pytest.approx(90_000)   # 80k salary + 10k bonus
    assert earned[37] == pytest.approx(80_000)   # salary only, bonus ended
    # non-covered rental never counts toward the record
    assert all(v != pytest.approx(20_000) for v in earned.values())
    # prior history fills the pre-plan years it doesn't already know
    assert earned[24] == pytest.approx(50_000)
    # recorded actuals override the prior-history fill for their age
    assert earned[28] == pytest.approx(60_000)
    # no earnings credited after the salary stops and streams end
    assert 45 not in earned


def test_estimate_pia_matches_manual_record():
    scn = _mini_scenario(work_start_age=22, prior_avg_earnings=50_000)
    earned = covered_earnings_by_age(scn, SALARY_PATH)
    assert estimate_pia(scn, SALARY_PATH) == pytest.approx(
        estimate_monthly_at_fra(earned)
    )


def test_empty_record_yields_zero():
    assert estimate_monthly_at_fra({}) == 0.0
