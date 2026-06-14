"""Outcome-distribution & robustness metrics: ending balance, delivered
spending, age-at-ruin, max drawdown, sequence-of-returns scatter, and the
Wilson success-rate interval. Closed-form / frozen-market checks."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import (
    Account,
    AccountType,
    Allocation,
    Event,
    EventKind,
    ExpenseStream,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
)


def _frozen_market(stock: float = 0.05, bond: float = 0.05) -> dict:
    """Fresh (non-shared) zero-variance, zero-inflation market each call."""
    return dict(
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": stock, "vol": 0.0},
                           bonds={"real_cagr": bond, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )


def _growth_scenario(n_paths: int = 8, balance: float = 100000) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1990, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=balance, cost_basis=balance)],
        allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        income=Income(gross_salary=0),
        retirement_age=36,
        expense_streams=[],
        sim=SimSettings(n_paths=n_paths, start_year=2026),
        **_frozen_market(stock=0.05, bond=0.05),
    )


def _spenddown_scenario(n_paths: int = 10) -> Scenario:
    """1M Roth basis, 40k/yr, 0% return -> fails in the 26th year (age 90)."""
    return Scenario(
        profile=Profile(birth_year=1961, horizon_age=90, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                          roth_contribution_basis=1_000_000)],
        income=Income(gross_salary=0),
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=40000)],
        sim=SimSettings(n_paths=n_paths, start_year=2026),
        **_frozen_market(stock=0.0, bond=0.0),
    )


def test_ending_balance_distribution_closed_form():
    s = _growth_scenario()
    eb = m.ending_balance_distribution(run(s))
    expected = 100000 * 1.05 ** s.n_years
    assert len(eb["real"]) == s.sim.n_paths
    assert np.allclose(eb["real"], expected)
    assert np.allclose(eb["nominal"], expected)  # 0% inflation -> real == nominal


def test_max_drawdown_single_crash():
    """0% growth except one -50% crash year -> exactly a 50% real drawdown."""
    s = Scenario(
        profile=Profile(birth_year=1990, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=100000, cost_basis=100000)],
        allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        income=Income(gross_salary=0),
        retirement_age=36,
        expense_streams=[],
        events=[Event(kind=EventKind.crash, age=40, stock_return=-0.5)],
        sim=SimSettings(n_paths=4, start_year=2026),
        **_frozen_market(stock=0.0, bond=0.0),
    )
    assert np.allclose(m.max_drawdown_distribution(run(s)), 0.5)


def test_age_at_ruin_all_fail():
    r = run(_spenddown_scenario(10))
    ar = m.age_at_ruin(r)
    assert ar["ages"] == [90]
    assert ar["counts"] == [10]
    assert ar["success_paths"] == 0
    assert ar["total_paths"] == 10


def test_success_ci_all_fail_lower_bound_zero():
    ci = m.success_ci(run(_spenddown_scenario(10)))
    assert ci["rate"] == 0.0
    assert ci["lo"] == 0.0
    assert ci["n_paths"] == 10


def test_success_ci_wilson_shrinks_with_n():
    small = m.success_ci(run(_growth_scenario(n_paths=50, balance=1_000_000)))
    big = m.success_ci(run(_growth_scenario(n_paths=2000, balance=1_000_000)))
    assert small["rate"] == 1.0 and big["rate"] == 1.0
    assert small["hi"] == pytest.approx(1.0) and big["hi"] == pytest.approx(1.0)
    assert big["lo"] > small["lo"]  # more paths -> tighter interval


def test_spending_distribution_no_guardrails():
    s = _spenddown_scenario(4)
    sd = m.spending_distribution(run(s))
    assert np.allclose(sd["total_real"], 40000 * s.n_years)  # 40k/yr, 0% infl
    assert all(c == 0 for c in sd["years_in_cut"])  # guardrails off -> no cuts


def test_sequence_scatter_shape_and_values():
    s = _growth_scenario(n_paths=6)
    sc = m.sequence_scatter(run(s))
    assert sc["window"] == 5
    assert len(sc["first_window_return"]) == 6
    assert np.allclose(sc["first_window_return"], 0.05)  # real return, 0% infl
    assert all(sc["survived"])
    assert np.allclose(sc["ending_real"], 100000 * 1.05 ** s.n_years)
