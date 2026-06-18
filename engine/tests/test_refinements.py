"""Tests for the refinement-pass additions: expense-ratio drag, the legacy
bequest floor, the retirement-only max-sustainable-spend, lifetime effective
tax rate, the ladder tax-savings number, and the bridge funding plan."""

import numpy as np
import pytest

from fire_engine import Scenario, example_scenario, run
from fire_engine.scenario import (
    Account, AccountType, ExpenseStream, Income, InflationModel, MarketModel,
    Profile, SimSettings,
)

FROZEN = dict(
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _grow_scenario(expense_ratio: float = 0.0) -> Scenario:
    """Retired, no flows, 5% real across stocks+bonds, zero inflation — pure
    compounding, so the expense-ratio drag is exactly checkable."""
    return Scenario(
        profile=Profile(birth_year=1990, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=100000, cost_basis=100000)],
        income=Income(gross_salary=0),
        retirement_age=36,
        expense_streams=[],
        sim=SimSettings(n_paths=4, start_year=2026),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.05, "vol": 0.0},
                           bonds={"real_cagr": 0.05, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0, expense_ratio=expense_ratio),
        **FROZEN,
    )


def test_expense_ratio_drags_invested_return():
    r0 = run(_grow_scenario(0.0))
    r1 = run(_grow_scenario(0.01))
    n = r0.net_worth.shape[1]
    # 0% expense ratio: exact 5% compounding
    assert np.allclose(r0.net_worth[0], 100000 * 1.05 ** np.arange(n))
    # 1% expense ratio on a 100%-invested (stock+bond) portfolio: net 4%
    assert np.allclose(r1.net_worth[0], 100000 * 1.04 ** np.arange(n))


def _legacy_scenario(legacy: float) -> Scenario:
    """Frozen, no flows: every path ends at exactly its starting 1,000,000."""
    return Scenario(
        profile=Profile(birth_year=1980, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                          roth_contribution_basis=1_000_000)],
        income=Income(gross_salary=0),
        retirement_age=46,
        expense_streams=[],
        sim=SimSettings(n_paths=4, start_year=2026, legacy_target=legacy),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.0, "vol": 0.0},
                           bonds={"real_cagr": 0.0, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0),
        **FROZEN,
    )


def test_legacy_floor_lowers_success_but_not_ruin_metrics():
    from fire_engine.metrics import age_at_ruin, survival_curve

    r0 = run(_legacy_scenario(0.0))          # pure die-with-zero
    r_met = run(_legacy_scenario(500_000))   # floor below the 1M ending
    r_miss = run(_legacy_scenario(2_000_000))  # floor above the 1M ending

    assert r0.success_rate == 1.0
    assert r_met.success_rate == 1.0
    assert r_miss.success_rate == 0.0  # ended at 1M < 2M target

    # the legacy floor is terminal only — it must not touch the mid-stream
    # failure machinery the survival curve and ruin histogram read from.
    assert np.array_equal(r0.fail, r_miss.fail)
    assert survival_curve(r0) == survival_curve(r_miss)
    assert age_at_ruin(r0)["success_paths"] == age_at_ruin(r_miss)["success_paths"]

    # the headline success-CI rate must agree with success_rate (both fold in legacy)
    from fire_engine.metrics import success_ci
    assert success_ci(r0)["rate"] == pytest.approx(1.0)
    assert success_ci(r_miss)["rate"] == pytest.approx(0.0)


def test_legacy_zero_is_identical_to_before():
    """legacy_target defaults to 0, so success is unchanged from the legacy-free
    definition on a real scenario."""
    s = example_scenario()
    s.sim.n_paths = 300
    r = run(s)
    plain = float(1.0 - r.fail.any(axis=1).mean())
    assert r.success_rate == pytest.approx(plain)


def test_gross_income_recorded_during_working_years():
    s = example_scenario()
    s.sim.n_paths = 50
    r = run(s)
    assert r.gross_income is not None
    assert r.gross_income.shape == (50, s.n_years)
    assert r.gross_income[:, 0].mean() > 0  # salary in the first (working) year


def test_lifetime_effective_rate_present_and_bounded():
    from fire_engine.metrics import lifetime_tax

    s = example_scenario()
    s.sim.n_paths = 200
    lt = lifetime_tax(run(s))
    assert "effective_rate" in lt
    assert 0.0 <= lt["effective_rate"] < 1.0


def test_max_sustainable_spend_has_retirement_variant():
    from fire_engine.metrics import max_sustainable_spend

    s = example_scenario()
    s.sim.n_paths = 200
    out = max_sustainable_spend(s, n_paths=200)
    assert out["retirement_max_scale"] >= 0.0
    assert out["retirement_max_living_annual"] == pytest.approx(
        out["retirement_max_scale"] * out["base_living_annual"])


def test_ladder_tax_savings_arithmetic():
    from fire_engine.metrics import ladder_tax_savings

    s = example_scenario()  # has a fill-bracket ladder
    s.sim.n_paths = 200
    out = ladder_tax_savings(s, n_paths=200)
    assert out["saved_real"] == pytest.approx(
        out["without_ladder_real"] - out["with_ladder_real"])


def test_bridge_funding_plan_present():
    from fire_engine.metrics import bridge_analysis

    s = example_scenario()  # retire 45 -> has a bridge to 60
    s.sim.n_paths = 200
    b = bridge_analysis(run(s))
    assert b["has_bridge"]
    assert b["bridge_funding_years"] >= 1
    assert b["bridge_funding_total_real"] >= 0.0
    assert set(b["bridge_funding_by_source"]) == {"cash", "taxable", "roth_basis"}
