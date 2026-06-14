"""Decision-surface analyses: max-sustainable-spend bisection, the 2D success
surface, the sensitivity tornado, and the income-shock stress test."""

import numpy as np
import pytest

from fire_engine import Scenario, example_scenario, run
from fire_engine import metrics as m
from fire_engine.sampling import sample_paths
from fire_engine.scenario import (
    Account,
    AccountType,
    ExpenseStream,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
    TaxRegimeShock,
)


def _det_spenddown() -> Scenario:
    """1.3M, 40k/yr living, 0% return -> at 40k the money funds exactly the
    25-year horizon, so the max scale is 1.3M/25/40k = 1.30."""
    return Scenario(
        profile=Profile(birth_year=1980, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=1_300_000, cost_basis=1_300_000)],
        income=Income(gross_salary=0),
        retirement_age=46,
        expense_streams=[ExpenseStream(name="living", annual=40000, essential=True)],
        sim=SimSettings(n_paths=4, start_year=2026, success_threshold=0.9),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.0, "vol": 0.0},
                           bonds={"real_cagr": 0.0, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0}, dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )


def test_max_spend_finds_boundary():
    s = _det_spenddown()
    res = m.max_sustainable_spend(s, n_paths=4, tolerance=0.005)
    thr = s.sim.success_threshold
    # at the reported scale spending is still sustainable; just above it, not
    assert run(s, spending_scale=res["max_scale"]).success_rate >= thr
    assert run(s, spending_scale=res["max_scale"] + 0.05).success_rate < thr
    assert res["max_living_annual"] == pytest.approx(res["max_scale"] * 40000)
    assert res["max_scale"] == pytest.approx(1.30, abs=0.02)


def test_surface_monotone_in_spending():
    s = example_scenario()
    s.sim.n_paths = 200
    res = m.success_surface(s, ages=[s.start_age, s.start_age + 5],
                            spending_scales=[0.8, 1.0, 1.2], n_paths=200)
    assert len(res["matrix"]) == 3 and len(res["matrix"][0]) == 2
    for j in range(len(res["ages"])):  # each column: more spending never raises success
        col = [res["matrix"][i][j] for i in range(len(res["spending_scales"]))]
        assert all(col[k] >= col[k + 1] - 1e-9 for k in range(len(col) - 1))


def test_tornado_signs_and_sorted():
    s = example_scenario()
    s.market.mode = "parametric"
    s.sim.n_paths = 400
    res = m.sensitivity_tornado(s, n_paths=400)
    assert len(res["entries"]) == 7
    by = {e["param"]: e for e in res["entries"]}
    assert by["Spending Level"]["high_success"] <= by["Spending Level"]["low_success"] + 1e-9
    assert by["Stock Return"]["high_success"] >= by["Stock Return"]["low_success"] - 1e-9
    swings = [abs(e["high_success"] - e["low_success"]) for e in res["entries"]]
    assert swings == sorted(swings, reverse=True)


def test_income_stress_drops_success():
    s = example_scenario()
    s.sim.n_paths = 300
    res = m.income_stress(s, shock_age=30, duration=3, n_paths=300)
    assert res["stressed_success"] <= res["base_success"] + 1e-9
    assert res["delta"] <= 1e-9
    assert res["shock_age"] == 30 and res["duration"] == 3


def test_roth_vs_trad_structure_and_determinism():
    s = example_scenario()
    s.sim.n_paths = 300
    res = m.roth_vs_trad(s, n_paths=300)
    for k in ("trad", "roth"):
        assert 0.0 <= res[k]["success_rate"] <= 1.0
        assert res[k]["lifetime_tax_real"] >= 0.0
    # diffs are exactly the component differences
    assert res["tax_diff"] == pytest.approx(
        res["roth"]["lifetime_tax_real"] - res["trad"]["lifetime_tax_real"])
    assert res["ending_diff"] == pytest.approx(
        res["roth"]["ending_real"] - res["trad"]["ending_real"])
    # the two strategies are genuinely different (not accidentally identical)
    assert res["trad"]["lifetime_tax_real"] != res["roth"]["lifetime_tax_real"]
    # same shared paths -> re-running gives identical numbers
    assert m.roth_vs_trad(s, n_paths=300)["tax_diff"] == pytest.approx(res["tax_diff"])


def test_tax_regime_identity_when_multipliers_are_one():
    """A no-op shock (rates ×1, deduction ×1) must reproduce the baseline exactly."""
    s = example_scenario()
    s.sim.n_paths = 50
    p = sample_paths(s, n_paths=50)
    base = run(s, paths=p)
    noop = run(s, paths=p, tax_regime=TaxRegimeShock(
        sunset_age=s.start_age, bracket_rate_mult=1.0, std_deduction_mult=1.0))
    assert np.allclose(base.taxes_paid, noop.taxes_paid)


def test_tax_regime_reversion_raises_tax_and_cannot_raise_success():
    """A TCJA-style reversion at retirement can only raise lifetime tax and can
    only hurt (never help) the success rate."""
    s = example_scenario()
    s.sim.n_paths = 300
    res = m.tax_regime_stress(s, sunset_age=s.retirement_age, n_paths=300)
    assert res["stressed_lifetime_tax_real"] >= res["base_lifetime_tax_real"]
    assert res["stressed_success"] <= res["base_success"] + 1e-9
