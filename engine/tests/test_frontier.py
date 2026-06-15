"""Die-with-zero analytics: the over-saving frontier (estate vs retirement age)
and the dense median-RMD series behind the traditional over-funding view."""

import pytest

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import (
    Account, AccountType, ConversionRule, ExpenseStream, Income,
    InflationModel, MarketModel, Profile, SimSettings,
)


def _flat_market(rate: float) -> dict:
    return dict(
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": rate, "vol": 0.0},
                           bonds={"real_cagr": rate, "vol": 0.0},
                           cash={"real_cagr": rate, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )


def test_frontier_estate_rises_with_later_retirement():
    """The over-saving signal: working longer can't lower success and (with a
    saver who has surplus income) leaves a strictly larger estate — the price of
    one more year, made explicit."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=90, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=200000, cost_basis=200000)],
        income=Income(gross_salary=120000, real_growth=0.0, growth_mode="real"),
        retirement_age=50,
        expense_streams=[ExpenseStream(name="living", annual=40000, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **_flat_market(0.04),
    )
    full = m.retirement_sweep_full(s, ages=[50, 55, 60], n_paths=2)
    succ = [full["success"][a] for a in (50, 55, 60)]
    est = [full["estate_p50"][a] for a in (50, 55, 60)]
    assert succ == sorted(succ)             # retiring later never hurts success
    assert est[0] < est[1] < est[2]         # ...and leaves more behind each time
    # p25 <= p50 <= p75 at every candidate age
    for a in (50, 55, 60):
        assert full["estate_p25"][a] <= full["estate_p50"][a] <= full["estate_p75"][a]


def test_retirement_sweep_delegates_to_full():
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=500000, cost_basis=500000)],
        income=Income(gross_salary=0),
        retirement_age=50,
        expense_streams=[ExpenseStream(name="living", annual=20000, inflates=False)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **_flat_market(0.03),
    )
    ages = [50, 55, 60]
    assert m.retirement_sweep(s, ages=ages, n_paths=2) == \
        m.retirement_sweep_full(s, ages=ages, n_paths=2)["success"]


def test_rmds_median_real_dense_and_fires_at_75():
    """The traditional over-funding series: a dense per-year median RMD, zero
    before 75 and positive once the IRS forces withdrawals from a large pre-tax
    balance the ladder never touched."""
    s = Scenario(
        profile=Profile(birth_year=1981, horizon_age=85, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.trad_401k, balance=2_000_000)],
        income=Income(gross_salary=0),
        retirement_age=45,
        expense_streams=[ExpenseStream(name="living", annual=30000, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **_flat_market(0.03),
    )
    s.withdrawal_policy.allow_early_trad_with_penalty = True
    summary = m.summarize(run(s))
    rmd = summary["rmds_median_real"]
    ages = list(range(45, 45 + len(rmd)))
    assert len(rmd) == len(ages)
    idx75 = ages.index(75)
    assert all(v < 1 for v in rmd[:idx75])  # nothing forced before 75
    assert rmd[idx75] > 0                    # ...then the RMD bomb goes off
