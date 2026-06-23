"""Secondary income streams layered on the primary salary (barista FI, side
hustles, rental), including the employer-match anchoring and optional volatility."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account, AccountType, Income, IncomeStream, InflationModel, MarketModel,
    Profile, SimSettings,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _worker(streams, *, salary=100000, match=0.04, horizon=50, n_paths=2) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=horizon, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=0)],
        income=Income(gross_salary=salary, real_growth=0.0, growth_mode="real",
                      employer_match_pct=match),
        income_streams=streams,
        retirement_age=horizon,  # never retires within the horizon
        expense_streams=[],
        sim=SimSettings(n_paths=n_paths, start_year=2026),
        **NO_GROWTH,
    )


def test_no_streams_is_unchanged():
    """An empty income_streams list must reproduce single-salary behavior."""
    base = run(_worker([]))
    # baseline sanity: a salaried worker with no expenses accumulates net worth
    assert base.net_worth[0, -1] > base.net_worth[0, 0]


def test_secondary_stream_adds_savings():
    base = run(_worker([]))
    withside = run(_worker([IncomeStream(name="Consulting", annual=40000)]))
    # the extra income (after tax, no expenses) ends up invested
    assert withside.net_worth[0, -1] > base.net_worth[0, -1]


def test_match_anchors_to_primary_only():
    """The employer match keys off the primary salary; a secondary stream must
    not inflate it."""
    base = run(_worker([]))
    withside = run(_worker([IncomeStream(name="Rental", annual=50000)]))
    base_match = base.contrib_pools["match"][0]
    side_match = withside.contrib_pools["match"][0]
    assert np.allclose(base_match, side_match)
    # and the match is exactly 4% of the primary salary (zero inflation)
    assert base_match[0] == pytest.approx(0.04 * 100000)


def test_stream_window_gates_income():
    """A stream active only over [start_age, end_age] contributes income (hence
    savings) inside the window and nothing outside it."""
    s = _worker([IncomeStream(name="Gig", annual=60000, start_age=42, end_age=44)],
                salary=0, match=0.0)
    r = run(s)
    start_age = s.start_age
    contrib = r.contributions[0]  # (T,)
    for t, age in enumerate(range(start_age, start_age + len(contrib))):
        if 42 <= age <= 44:
            assert contrib[t] > 0.0, f"expected income at age {age}"
        else:
            assert contrib[t] == pytest.approx(0.0), f"unexpected income at age {age}"


def _with_bonus(bonus, bonus_vol=0.0, *, salary=100000, match=0.04,
                horizon=50, retire=50, n_paths=2) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=horizon, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=0)],
        income=Income(gross_salary=salary, real_growth=0.0, growth_mode="real",
                      employer_match_pct=match, bonus=bonus, bonus_vol=bonus_vol),
        income_streams=[],
        retirement_age=retire,
        expense_streams=[],
        sim=SimSettings(n_paths=n_paths, start_year=2026),
        **NO_GROWTH,
    )


def test_bonus_adds_wages_and_savings():
    base = run(_with_bonus(0))
    withbonus = run(_with_bonus(20000))
    # the bonus shows up as extra wages and, after tax with no expenses, savings
    assert withbonus.wages[0, 0] == pytest.approx(base.wages[0, 0] + 20000)
    assert withbonus.net_worth[0, -1] > base.net_worth[0, -1]


def test_bonus_not_in_match_base():
    """The employer match keys off base salary; the bonus must not inflate it."""
    base = run(_with_bonus(0))
    withbonus = run(_with_bonus(50000))
    assert np.allclose(base.contrib_pools["match"][0], withbonus.contrib_pools["match"][0])
    assert base.contrib_pools["match"][0][0] == pytest.approx(0.04 * 100000)


def test_bonus_stops_at_retirement():
    s = _with_bonus(30000, salary=0, match=0.0, horizon=60, retire=45)
    r = run(s)
    start_age = s.start_age
    for t, age in enumerate(range(start_age, start_age + r.wages.shape[1])):
        if age < 45:
            assert r.wages[0, t] == pytest.approx(30000), f"expected bonus at age {age}"
        else:
            assert r.wages[0, t] == pytest.approx(0.0), f"unexpected bonus at age {age}"


def test_bonus_volatility_spreads_outcomes_unbiased():
    vol = run(_with_bonus(40000, bonus_vol=0.3, salary=0, match=0.0, n_paths=400))
    steady = run(_with_bonus(40000, bonus_vol=0.0, salary=0, match=0.0, n_paths=400))
    ending = vol.net_worth[:, -1]
    assert ending.std() > 0.0  # vol alone (flat market/inflation) spreads outcomes
    # the mean-1 lognormal multiplier keeps expected savings ~unbiased
    assert ending.mean() == pytest.approx(steady.net_worth[:, -1].mean(), rel=0.02)


def test_income_volatility_is_seeded_and_spreads_outcomes():
    streams = [IncomeStream(name="Variable gig", annual=40000, vol=0.3)]
    a = run(_worker(streams, n_paths=400))
    b = run(_worker(streams, n_paths=400))
    # same seed -> identical paths
    assert np.allclose(a.net_worth, b.net_worth)
    # volatility alone (market + inflation are flat) spreads ending net worth
    ending = a.net_worth[:, -1]
    assert ending.std() > 0.0
    # the mean-1 lognormal multiplier keeps expected income ~unbiased vs no-vol
    steady = run(_worker([IncomeStream(name="Variable gig", annual=40000, vol=0.0)],
                         n_paths=400))
    assert ending.mean() == pytest.approx(steady.net_worth[:, -1].mean(), rel=0.02)
