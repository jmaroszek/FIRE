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


def test_tornado_zero_alloc_asset_sits_on_base():
    """Regression: in bootstrap mode with mean-shift off, a 0%-allocation asset
    must collapse ONTO the base line, not float off it. The market bars force
    mean-shift on; if the base didn't honor the same setting, re-centering the
    OTHER asset's returns would offset an inert bar from base."""
    s = example_scenario()
    s.market.mode = "bootstrap"
    s.market.bootstrap_mean_shift = False
    s.allocation.stocks = 1.0
    s.allocation.bonds = 0.0
    s.allocation.cash = 0.0
    s.sim.n_paths = 400
    res = m.sensitivity_tornado(s, n_paths=400)
    bond = next(e for e in res["entries"] if e["param"] == "Bond Return")
    # No bonds held -> perturbing the bond CAGR is a no-op, AND the bar must
    # land on the (consistently mean-shifted) base, not beside it.
    assert bond["low_success"] == pytest.approx(bond["high_success"])
    assert bond["low_success"] == pytest.approx(res["base_success"])


def test_income_stress_drops_success():
    s = example_scenario()
    s.sim.n_paths = 300
    res = m.income_stress(s, shock_age=30, duration=3, n_paths=300)
    assert res["stressed_success"] <= res["base_success"] + 1e-9
    assert res["delta"] <= 1e-9
    assert res["shock_age"] == 30 and res["duration"] == 3


def test_income_stress_earliest_age_never_improves():
    """A wage shock during accumulation can only push the earliest retirement age
    that clears the threshold later (or leave it unchanged) — never earlier. The
    two sweeps share seeded paths, so stressed success <= baseline at every age."""
    s = example_scenario()
    res = m.income_stress_earliest(s, shock_age=30, duration=3, n_paths=80)
    assert res["shock_age"] == 30 and res["duration"] == 3
    assert res["threshold"] == s.sim.success_threshold
    base, stressed = res["base_earliest_age"], res["stressed_earliest_age"]
    if base is not None and stressed is not None:
        assert stressed >= base


def test_ladder_tax_savings_structure_and_determinism():
    s = example_scenario()  # has a fill-bracket ladder
    s.sim.n_paths = 300
    res = m.ladder_tax_savings(s, n_paths=300)
    assert res["with_ladder_real"] >= 0.0
    assert res["without_ladder_real"] >= 0.0
    # saved is exactly the component difference
    assert res["saved_real"] == pytest.approx(
        res["without_ladder_real"] - res["with_ladder_real"])
    # same shared paths -> re-running gives identical numbers
    assert m.ladder_tax_savings(s, n_paths=300)["saved_real"] == pytest.approx(res["saved_real"])


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
