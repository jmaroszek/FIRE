"""ACA premium-subsidy (pre-65) and IRMAA Medicare surcharge (65+) modeling."""

import time

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.engine import _aca_applicable_pct, _irmaa_surcharge
from fire_engine.scenario import (
    ACAConfig,
    Account,
    AccountType,
    ConversionRule,
    ExpenseStream,
    IRMAABracket,
    IRMAAConfig,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
    example_scenario,
)

FROZEN = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0}, dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def test_aca_applicable_pct_schedule():
    # below 150% FPL -> 0%; the post-2021 cap is 8.5% with no cliff above 400%
    pct = _aca_applicable_pct(np.array([1.0, 1.5, 2.0, 3.0, 4.0, 6.0]))
    assert np.allclose(pct, [0.0, 0.0, 0.02, 0.06, 0.085, 0.085])


def test_irmaa_surcharge_steps():
    brackets = [IRMAABracket(magi_threshold=106000, annual_surcharge=1050),
                IRMAABracket(magi_threshold=133000, annual_surcharge=2640)]
    infl = np.ones(4)
    magi = np.array([90000, 120000, 140000, 200000])
    out = _irmaa_surcharge(magi, brackets, infl)
    assert np.allclose(out, [0.0, 1050, 2640, 2640])


def _aca_retiree() -> Scenario:
    """Retired at 47, funds 40k from a no-gain taxable account, and converts a
    fixed 50k/yr — so MAGI ≈ 50k (≈332% of the single FPL)."""
    return Scenario(
        profile=Profile(birth_year=1979, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=600_000, cost_basis=600_000),
                  Account(type=AccountType.trad_ira, balance=900_000)],
        income=Income(gross_salary=0),
        retirement_age=47,
        expense_streams=[ExpenseStream(name="living", annual=40000, essential=True)],
        conversion_rule=ConversionRule(kind="fixed", annual_amount=50000, end_age=64),
        aca=ACAConfig(enabled=True, benchmark_annual=12000, actual_annual=12000),
        sim=SimSettings(n_paths=3, start_year=2026),
        **FROZEN,
    )


def test_aca_subsidy_engine_value_and_stops_at_65():
    r = run(_aca_retiree())
    # year 0 (age 47), MAGI = 50k: applic ≈ 6.8% -> subsidy ≈ 8600, net ≈ 3400
    assert r.aca_subsidy[0, 0] == pytest.approx(8600, abs=80)
    assert r.net_health_cost[0, 0] == pytest.approx(3400, abs=80)
    # net premium never exceeds the actual premium
    actual_nom = 12000 * r.cum_inflation[:, :-1]
    assert (r.net_health_cost <= actual_nom + 1e-6).all()
    # ACA stops at Medicare age: no health cost at 65+
    post65 = r.ages >= 65
    assert np.allclose(r.net_health_cost[:, post65], 0.0)


def test_aca_can_start_after_retirement():
    s = _aca_retiree()
    s.aca = ACAConfig(
        enabled=True,
        benchmark_annual=12000,
        actual_annual=12000,
        coverage_start_age=50,
    )
    r = run(s)
    pre50 = r.ages < 50
    start_idx = np.where(r.ages == 50)[0][0]
    assert np.allclose(r.net_health_cost[:, pre50], 0.0)
    assert np.all(r.net_health_cost[:, start_idx] > 0)
    assert np.all(r.aca_subsidy[:, start_idx] > 0)


def test_aca_disabled_is_zero():
    s = _aca_retiree()
    s.aca = ACAConfig(enabled=False)
    r = run(s)
    assert np.allclose(r.net_health_cost, 0.0)
    assert np.allclose(r.aca_subsidy, 0.0)


def test_irmaa_engine_surcharge_at_65():
    # born 1961 -> start_age 65; convert 120k/yr so MAGI ≈ 120k -> first tier (1050)
    s = Scenario(
        profile=Profile(birth_year=1961, horizon_age=75, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=400_000, cost_basis=400_000),
                  Account(type=AccountType.trad_ira, balance=2_000_000)],
        income=Income(gross_salary=0),
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=30000, essential=True)],
        conversion_rule=ConversionRule(kind="fixed", annual_amount=120000, end_age=74),
        irmaa=IRMAAConfig(enabled=True),
        sim=SimSettings(n_paths=3, start_year=2026),
        **FROZEN,
    )
    r = run(s)
    assert r.net_health_cost[0, 0] == pytest.approx(1050, abs=1)


def test_health_features_performance_budget():
    s = example_scenario()
    s.sim.n_paths = 2000
    s.aca = ACAConfig(enabled=True, benchmark_annual=12000, actual_annual=11000)
    s.irmaa = IRMAAConfig(enabled=True)
    run(s)  # warm
    start = time.perf_counter()
    run(s)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.75, f"engine too slow with ACA+IRMAA on: {elapsed:.2f}s"
