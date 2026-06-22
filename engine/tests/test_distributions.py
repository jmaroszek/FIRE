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
    SpendingStrategy,
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


def _pct_strategy_scenario(balance: float, annual: float, essential: bool,
                           strategy: SpendingStrategy) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1980, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=balance, cost_basis=balance)],
        allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        income=Income(gross_salary=0),
        retirement_age=46,  # = current age (born 1980, start 2026) -> retired at t=0
        expense_streams=[ExpenseStream(name="living", annual=annual, essential=essential)],
        spending_strategy=strategy,
        sim=SimSettings(n_paths=2, start_year=2026),
        **_frozen_market(stock=0.0, bond=0.0),
    )


def test_percent_portfolio_spends_fixed_fraction_and_never_depletes():
    s = _pct_strategy_scenario(1_000_000, 50000, False,
                               SpendingStrategy(kind="percent_portfolio", rate=0.04, bounded=False))
    r = run(s)
    assert r.expenses[0, 0] == pytest.approx(40000, rel=1e-3)     # 4% of 1M (all taxable -> accessible)
    assert r.spending_mult[0, 0] == pytest.approx(0.8, rel=1e-3)  # 40k / 50k plan
    assert not r.fail.any()                                       # flexes, never runs short
    assert r.expenses[0, -1] > 0                                  # still spending at the horizon


def test_vpw_rate_matches_annuity_factor():
    n, rr = 70 - 46, 0.03
    rate = rr / (1 - (1 + rr) ** (-n))  # annuity payout factor at the retirement year
    s = _pct_strategy_scenario(1_000_000, 50000, False, SpendingStrategy(
        kind="percent_portfolio", rate_mode="vpw", vpw_real_return=0.03, bounded=False))
    r = run(s)
    assert r.expenses[0, 0] == pytest.approx(rate * 1_000_000, rel=1e-3)


def test_bounded_percent_clamps_to_plan_fraction():
    s = _pct_strategy_scenario(500_000, 50000, False, SpendingStrategy(
        kind="percent_portfolio", rate=0.04, bounded=True, floor_mult=0.75, ceiling_mult=1.25))
    r = run(s)
    # 4% of 500k = 20k is below the floor (0.75 × 50k = 37.5k) -> clamped up
    assert r.spending_mult[0, 0] == pytest.approx(0.75, rel=1e-3)
    assert r.expenses[0, 0] == pytest.approx(37500, rel=1e-3)


def test_percent_portfolio_still_fails_when_essentials_unfundable():
    s = _pct_strategy_scenario(100_000, 50000, True,
                               SpendingStrategy(kind="percent_portfolio", rate=0.04, bounded=False))
    r = run(s)
    assert r.fail.any()  # essentials are funded first; 100k can't cover 50k/yr of them


def test_legacy_spending_strategy_migration():
    """The old four-kind enum folds into the two-kind model, preserving behavior."""
    cp = SpendingStrategy(kind="constant_pct")
    assert (cp.kind, cp.rate_mode, cp.bounded) == ("percent_portfolio", "fixed", False)
    vpw = SpendingStrategy(kind="vpw")
    assert (vpw.kind, vpw.rate_mode, vpw.bounded) == ("percent_portfolio", "vpw", False)
    fc = SpendingStrategy(kind="floor_ceiling")
    assert (fc.kind, fc.rate_mode, fc.bounded) == ("percent_portfolio", "fixed", True)
    assert SpendingStrategy(kind="constant_dollar").kind == "constant_dollar"


def test_percent_portfolio_budgets_off_accessible_not_total():
    """Before 59.5, the percentage is taken on penalty-free accessible wealth, so a
    locked traditional balance does NOT inflate the spend (which would force the
    bridge to break)."""
    s = Scenario(
        profile=Profile(birth_year=1980, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=100_000, cost_basis=100_000),
                  Account(type=AccountType.trad_401k, balance=1_000_000)],
        allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        income=Income(gross_salary=0),
        retirement_age=46,  # pre-59.5: trad is locked behind the penalty
        expense_streams=[ExpenseStream(name="living", annual=50000, essential=False)],
        spending_strategy=SpendingStrategy(kind="percent_portfolio", rate=0.04, bounded=False),
        sim=SimSettings(n_paths=2, start_year=2026),
        **_frozen_market(stock=0.0, bond=0.0),
    )
    r = run(s)
    # 4% of accessible (taxable 100k) = 4k, NOT 4% of total 1.1M = 44k
    assert r.expenses[0, 0] == pytest.approx(4000, rel=1e-3)


def test_endowment_smoothing_blends_with_last_year():
    """smoothing α blends this year's portfolio-driven target with last year's
    realized spend. Year 0 has no prior (raw); year 1 is the half-and-half blend."""
    raw = SpendingStrategy(kind="percent_portfolio", rate=0.04, bounded=False)
    blend = SpendingStrategy(kind="percent_portfolio", rate=0.04, bounded=False, smoothing=0.5)
    r0 = run(_pct_strategy_scenario(1_000_000, 50000, False, raw))
    r1 = run(_pct_strategy_scenario(1_000_000, 50000, False, blend))
    # year 0: identical (no prior year to smooth against) -> 4% of 1M
    assert r1.expenses[0, 0] == pytest.approx(r0.expenses[0, 0], rel=1e-3) == pytest.approx(40000, rel=1e-3)
    # year 1: portfolio is 960k (spent 40k, 0% return) -> raw 38.4k; blend = 0.5*40k + 0.5*38.4k
    assert r0.expenses[0, 1] == pytest.approx(38400, rel=1e-3)
    assert r1.expenses[0, 1] == pytest.approx(39200, rel=1e-3)


def test_sequence_scatter_shape_and_values():
    s = _growth_scenario(n_paths=6)  # retires at 36 == current age, so anchor t=0
    sc = m.sequence_scatter(run(s))
    assert sc["window"] == 10
    assert sc["start_age"] == 36
    assert len(sc["first_window_return"]) == 6
    assert np.allclose(sc["first_window_return"], 0.05)  # real return, 0% infl
    assert all(sc["survived"])
    assert np.allclose(sc["ending_real"], 100000 * 1.05 ** s.n_years)


def test_sequence_scatter_anchored_at_retirement():
    """The window starts at the retirement year, not sim-start, so an early
    retiree's sequence risk is measured over the decade after they stop earning."""
    s = _growth_scenario(n_paths=6)
    s.retirement_age = 50  # current age is 36
    sc = m.sequence_scatter(run(s))
    assert sc["start_age"] == 50


def test_failure_magnitude_all_fail():
    """1M Roth / 40k yr / 0% -> every path runs short by exactly one year of
    spending in the final (26th) year; depth-of-ruin reports that, not just the count."""
    r = run(_spenddown_scenario(10))
    fm = m.failure_magnitude(r)
    assert fm["failing_paths"] == 10
    assert fm["total_paths"] == 10
    assert fm["median_years_short"] == 1
    assert fm["median_total_shortfall_real"] == pytest.approx(40000, rel=1e-3)


def test_failure_magnitude_no_failures_is_zero():
    fm = m.failure_magnitude(run(_growth_scenario(n_paths=8, balance=1_000_000)))
    assert fm["failing_paths"] == 0
    assert fm["median_total_shortfall_real"] == 0.0
    assert fm["median_years_short"] == 0.0


def test_lifetime_tax_roth_only_is_zero():
    """Spending from Roth basis with no other income -> zero lifetime tax."""
    lt = m.lifetime_tax(run(_spenddown_scenario(6)))
    assert lt["median_real"] == pytest.approx(0.0)
    assert lt["as_pct_of_spending"] == pytest.approx(0.0)


def test_port_return_and_inflation_fans():
    s = _growth_scenario(n_paths=8)
    r = run(s)
    pf = m.port_return_fan(r)
    assert len(pf["p50"]) == s.n_years          # per-year flow
    assert np.allclose(pf["p50"], 0.05)          # 100% stock @ 5% real, 0% infl
    inf = m.inflation_fan(r)
    assert len(inf["p50"]) == s.n_years + 1      # price level incl. t0
    assert np.allclose(inf["p50"], 1.0)          # 0% inflation -> flat index


def test_ss_income_median_real_zero_when_no_benefit():
    ss = m.ss_income_median_real(run(_spenddown_scenario(4)))
    assert all(x == 0 for x in ss)


def test_withdrawal_source_medians_record_actual_draws():
    """1M Roth / 40k yr / 0% -> spending is funded ~40k/yr from Roth contributions."""
    r = run(_spenddown_scenario(4))
    w = m.withdrawal_source_medians_real(r)
    assert "roth_basis" in w
    assert w["roth_basis"][0] == pytest.approx(40000, rel=1e-3)


def test_summarize_carries_new_keys():
    r = run(_growth_scenario(8))
    s = m.summarize(r)
    for key in ("ss_income_median_real", "marginal_rate_median", "port_return_fan",
                "inflation_fan", "lifetime_tax", "failure_magnitude"):
        assert key in s
