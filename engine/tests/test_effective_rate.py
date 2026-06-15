"""The effective (average) income-tax-rate series — the lower companion line to
the marginal rate shown on the Taxes chart."""

import numpy as np

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import (
    Account, AccountType, ExpenseStream, Income, InflationModel, MarketModel,
    Profile, SimSettings,
)

FROZEN = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0}, dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def test_effective_rate_is_positive_and_below_marginal():
    s = Scenario(
        profile=Profile(birth_year=1990, horizon_age=50, state_tax_rate=0.05),
        accounts=[Account(type=AccountType.taxable, balance=10000, cost_basis=10000)],
        income=Income(gross_salary=120000, real_growth=0.0, growth_mode="real"),
        retirement_age=49,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        sim=SimSettings(n_paths=3, start_year=2026),
        **FROZEN,
    )
    r = run(s)
    eff = m.effective_rate_median(r)
    marg = m.marginal_rate_median(r)
    assert len(eff) == len(r.ages)
    # first (working) year: pays tax, and the average rate sits below the marginal
    assert eff[0] > 0.0
    assert eff[0] < marg[0]
