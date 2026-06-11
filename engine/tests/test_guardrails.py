"""Spending guardrails: cuts engage at the upper rail, respect the floor,
recover after good markets, and materially improve marginal success rates."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account,
    AccountType,
    Event,
    EventKind,
    ExpenseStream,
    GuardrailRule,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
)

FROZEN = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def retiree(spend: float, guardrails: GuardrailRule, horizon: int = 95,
            n_paths: int = 2, **overrides) -> Scenario:
    base = dict(
        profile=Profile(birth_year=1961, horizon_age=horizon, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                          roth_contribution_basis=1_000_000)],
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=spend)],
        guardrails=guardrails,
        sim=SimSettings(n_paths=n_paths, start_year=2026),
        **FROZEN,
    )
    base.update(overrides)
    return Scenario(**base)


def test_cut_engages_at_upper_rail_and_respects_floor():
    """0% returns, 5% initial withdrawal: w0=5%, upper rail 6% -> first cut when
    the portfolio drops below 50k/0.06 = 833k. Floor stops cutting at 70%."""
    g = GuardrailRule(enabled=True, band=0.20, cut=0.10, boost=0.10,
                      floor_mult=0.70, cap_mult=1.0)
    result = run(retiree(50000, g))
    spend = result.expenses[0]
    mult = result.spending_mult[0]
    # year 0: w = 5% exactly -> no cut
    assert mult[0] == pytest.approx(1.0)
    assert spend[0] == pytest.approx(50000.0)
    # cuts engage as the portfolio depletes...
    assert mult[10] < 1.0
    # ...monotonically (0% returns mean no recovery boosts) and floored at 0.70
    assert np.all(np.diff(mult) <= 1e-12)
    assert np.min(mult) == pytest.approx(0.70)
    assert np.min(spend[~np.isnan(spend)]) >= 0.70 * 50000 - 1e-6
    # guardrails extended the runway versus the fixed-spending baseline
    base = run(retiree(50000, GuardrailRule(enabled=False)))
    first_fail = lambda r: int(np.argmax(r.fail[0])) if r.fail[0].any() else 999
    assert first_fail(result) > first_fail(base)


def test_essential_streams_are_exempt():
    g = GuardrailRule(enabled=True, band=0.20, cut=0.10, floor_mult=0.70)
    s = retiree(0, g, expense_streams=[
        ExpenseStream(name="mortgage", annual=30000, essential=True),
        ExpenseStream(name="fun", annual=30000),
    ])
    result = run(s)
    # late in the run cuts are active, but spending never drops below
    # essential + floored discretionary
    assert result.spending_mult[0, 12] < 1.0
    floor_spend = 30000 + 0.70 * 30000
    active = result.expenses[0][result.expenses[0] > 0]
    assert np.min(active) >= floor_spend - 1e-6


def test_boost_recovers_after_crash_but_capped_at_plan():
    """A crash forces cuts; strong subsequent growth pulls the withdrawal rate
    below the lower rail and spending recovers — but never above plan."""
    g = GuardrailRule(enabled=True, band=0.20, cut=0.10, boost=0.10,
                      floor_mult=0.70, cap_mult=1.0)
    s = retiree(40000, g, horizon=90,
                market=MarketModel(mode="parametric",
                                   stocks={"real_cagr": 0.08, "vol": 0.0},
                                   bonds={"real_cagr": 0.08, "vol": 0.0},
                                   cash={"real_cagr": 0.0, "vol": 0.0},
                                   dividend_yield=0.0),
                inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
                events=[Event(kind=EventKind.crash, age=66, stock_return=-0.35,
                              bond_return=-0.35)])
    result = run(s)
    mult = result.spending_mult[0]
    assert np.min(mult) < 1.0  # crash triggered cuts
    assert mult[-1] > np.min(mult)  # growth restored spending
    assert np.max(mult) <= 1.0 + 1e-12  # never above plan


def test_guardrails_improve_marginal_success():
    """At a marginal 4.7% withdrawal rate over 30 years, guardrails should buy
    a material success improvement."""
    def scenario(enabled):
        return Scenario(
            profile=Profile(birth_year=1961, horizon_age=94, state_tax_rate=0.0),
            accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                              roth_contribution_basis=1_000_000)],
            allocation={"stocks": 0.75, "bonds": 0.25, "cash": 0.0},
            retirement_age=65,
            expense_streams=[ExpenseStream(name="living", annual=47000)],
            guardrails=GuardrailRule(enabled=enabled),
            sim=SimSettings(n_paths=800, seed=7, start_year=2026),
        )

    s_off = run(scenario(False)).success_rate
    s_on = run(scenario(True)).success_rate
    assert s_on > s_off + 0.03, f"guardrails {s_on:.3f} vs fixed {s_off:.3f}"
