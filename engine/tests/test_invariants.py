"""Engine-level conservation invariants.

These tests pin down the property that money is neither created nor destroyed
except through explicit channels: income in, taxes/expenses out, conversions and
withdrawals merely move dollars between pools, and market returns scale them.
Run with zero growth / zero tax wherever possible so net worth is hand-checkable.

The matured-conversion tests are direct regressions for a leak where spending
seasoned Roth-conversion principal debited the conversion ledger but not the
Roth pool, leaving the spent dollars in the account and overstating net worth.
"""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account,
    AccountType,
    ConversionRule,
    Event,
    EventKind,
    ExpenseStream,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _flat_market(rate: float) -> dict:
    """Every asset (including cash) returns `rate`, so the blended return is
    `rate` for any allocation and net worth compounds at exactly (1+rate)."""
    return dict(
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": rate, "vol": 0.0},
                           bonds={"real_cagr": rate, "vol": 0.0},
                           cash={"real_cagr": rate, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )


def test_spending_matured_conversions_draws_down_roth_and_net_worth():
    """Regression: a fully-seasoned conversion spent in retirement must reduce
    the Roth pool dollar-for-dollar. Zero growth + tax-free matured-conversion
    withdrawals => net worth falls by exactly the annual spend each year."""
    s = Scenario(
        profile=Profile(birth_year=1981, horizon_age=49, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=200000,
                          roth_contribution_basis=0.0,
                          roth_conversions={2015: 200000})],  # matured well before 2026
        income=Income(gross_salary=0),
        retirement_age=45,
        expense_streams=[ExpenseStream(name="living", annual=20000, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    expected = 200000 - 20000 * np.arange(result.net_worth.shape[1])
    assert np.allclose(result.net_worth[0], expected)
    assert np.allclose(result.pools["roth"][0], expected)
    assert np.allclose(result.taxes_paid[0], 0.0)
    assert not result.fail[0].any()


def test_zero_return_conversion_ladder_conserves_net_worth():
    """A pure ladder (no income, no spending, no tax, no growth) only shuffles
    dollars trad->roth; net worth is exactly constant year over year."""
    s = Scenario(
        profile=Profile(birth_year=1981, horizon_age=58, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.trad_401k, balance=300000),
                  Account(type=AccountType.cash, balance=50000)],
        income=Income(gross_salary=0),
        retirement_age=45,
        expense_streams=[],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="std_deduction"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    assert np.allclose(result.net_worth[0], 350000.0)
    assert np.allclose(result.taxes_paid[0], 0.0)
    # the ladder really ran: traditional drained into the Roth
    assert result.pools["trad"][0, -1] < result.pools["trad"][0, 0]
    assert result.pools["roth"][0, -1] > result.pools["roth"][0, 0]
    # trad lost exactly what roth gained (conversions are internal transfers)
    trad_drop = result.pools["trad"][0, 0] - result.pools["trad"][0, -1]
    roth_gain = result.pools["roth"][0, -1] - result.pools["roth"][0, 0]
    assert trad_drop == pytest.approx(roth_gain)


def test_conversion_ladder_under_growth_tracks_pure_compounding():
    """With a ladder but no external cash flows and tax-free conversions, net
    worth compounds at exactly the market rate: internal trad->roth moves
    neither leak nor create dollars, and both pools grow at the same rate."""
    rate = 0.05
    s = Scenario(
        profile=Profile(birth_year=1981, horizon_age=58, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.trad_401k, balance=300000)],
        income=Income(gross_salary=0),
        retirement_age=45,
        expense_streams=[],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="std_deduction"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **_flat_market(rate),
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    T1 = result.net_worth.shape[1]
    assert np.allclose(result.net_worth[0], 300000 * (1 + rate) ** np.arange(T1))
    assert np.allclose(result.taxes_paid[0], 0.0)


def test_windfall_event_adds_its_value_to_net_worth():
    """A one-time inflow (negative amount) lands in its destination account and
    raises net worth by exactly its size; with zero growth it then persists."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=42, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=100000)],
        income=Income(gross_salary=0),
        retirement_age=40,
        expense_streams=[],
        events=[Event(kind=EventKind.one_time_flow, name="inheritance",
                      age=41, amount=-50000, account=AccountType.taxable)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    assert result.net_worth[0, 0] == pytest.approx(100000.0)   # start
    assert result.net_worth[0, 1] == pytest.approx(100000.0)   # end of pre-windfall year
    assert result.net_worth[0, -1] == pytest.approx(150000.0)  # windfall landed and stuck
    assert result.pools["taxable"][0, -1] == pytest.approx(50000.0)


@pytest.mark.parametrize(
    "dest,pool",
    [
        (AccountType.trad_401k, "trad"),
        (AccountType.roth_ira, "roth"),
        (AccountType.hsa, "hsa"),
    ],
)
def test_windfall_lands_in_its_destination_retirement_account(dest, pool):
    """A windfall (negative one-time flow) routed to a specific tax-advantaged
    account lands in that pool — not the default taxable bucket — and raises net
    worth by exactly its size. The taxable case is covered separately; this pins
    the trad / Roth / HSA destination branches."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=42, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=100000)],
        income=Income(gross_salary=0),
        retirement_age=40,
        expense_streams=[],
        events=[Event(kind=EventKind.one_time_flow, name="gift",
                      age=41, amount=-50000, account=dest)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    assert result.net_worth[0, -1] == pytest.approx(150000.0)   # windfall stuck
    assert result.pools[pool][0, -1] == pytest.approx(50000.0)  # in the right pool
    assert result.pools["cash"][0, -1] == pytest.approx(100000.0)  # cash untouched


def test_recurring_flow_windfall_repeats_on_its_interval():
    """A recurring inflow fires at every interval through end_age and nowhere
    else: three occurrences (ages 41, 43, 45) of 10,000 each, so with zero growth
    net worth ends exactly 30,000 above where it started."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=47, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=1000)],
        income=Income(gross_salary=0),
        retirement_age=40,
        expense_streams=[],
        events=[Event(kind=EventKind.recurring_flow, name="periodic gift",
                      age=41, amount=-10000, interval_years=2, end_age=45,
                      account=AccountType.cash)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    result = run(s)
    # three inflows of 10k land; the fourth (age 47) is past end_age 45, so none
    assert result.net_worth[0, -1] == pytest.approx(1000 + 30000.0)
    assert result.net_worth[0] == pytest.approx(sorted(result.net_worth[0]))  # only ever rises


def test_employer_match_is_external_money_in_traditional():
    """The match is employer money: it is recorded in the match pool and lands
    in the traditional account on top of the employee's own contributions."""
    s = Scenario(
        profile=Profile(birth_year=2000, horizon_age=27, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=0)],
        income=Income(gross_salary=100000, real_growth=0.0, growth_mode="real",
                      employer_match_pct=0.05),
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=40000, inflates=False)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    result = run(s)
    # 5% of 100k salary, contributed to traditional 401k in year 0
    assert result.contrib_pools["match"][0, 0] == pytest.approx(5000.0)
    # the match arrives in the traditional pool (alongside the employee's deferral)
    assert result.pools["trad"][0, 1] >= 5000.0
