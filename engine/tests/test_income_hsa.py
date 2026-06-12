"""Nominal-vs-real salary growth conversion and the HSA cash buffer."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account,
    AccountType,
    HSARule,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
)


def test_nominal_growth_converts_at_expected_inflation():
    income = Income(gross_salary=100000, real_growth=0.03, growth_mode="nominal")
    assert income.effective_real_growth(0.025) == pytest.approx(1.03 / 1.025 - 1)
    real = Income(gross_salary=100000, real_growth=0.03, growth_mode="real")
    assert real.effective_real_growth(0.025) == pytest.approx(0.03)


def test_nominal_mode_with_zero_inflation_equals_real_mode():
    def scenario(mode):
        return Scenario(
            profile=Profile(birth_year=1996, horizon_age=40, state_tax_rate=0.0),
            accounts=[Account(type=AccountType.taxable, balance=10000, cost_basis=10000)],
            income=Income(gross_salary=100000, real_growth=0.03, growth_mode=mode),
            retirement_age=41,
            expense_streams=[],
            sim=SimSettings(n_paths=2, start_year=2026),
            market=MarketModel(mode="parametric",
                               stocks={"real_cagr": 0.0, "vol": 0.0},
                               bonds={"real_cagr": 0.0, "vol": 0.0},
                               cash={"real_cagr": 0.0, "vol": 0.0},
                               dividend_yield=0.0),
            inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
        )

    a = run(scenario("nominal"))
    b = run(scenario("real"))
    assert np.allclose(a.net_worth, b.net_worth)


def test_hsa_cash_buffer_earns_cash_return():
    s = Scenario(
        profile=Profile(birth_year=1996, horizon_age=31, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.hsa, balance=10000)],
        income=Income(gross_salary=0),
        retirement_age=30,
        expense_streams=[],
        hsa=HSARule(utilization=1.0, cash_buffer=2000),
        sim=SimSettings(n_paths=2, start_year=2026),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.10, "vol": 0.0},
                           bonds={"real_cagr": 0.10, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )
    result = run(s)
    # 2k parked at 0%, 8k invested at 10% -> 10.8k after year one
    assert result.pools["hsa"][0, 1] == pytest.approx(2000 + 8000 * 1.10)
