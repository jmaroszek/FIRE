"""Bridge-period (early-retirement → 59½) liquidity diagnostics.

These pin down the distinction the headline success rate blurs: a *bridge*
liquidity crunch (penalty-free money runs out before 60) versus a *longevity*
shortfall late in the plan, and the early-withdrawal penalty cost that an overall
"success" can hide. Run zero-growth / zero-vol so every path is identical and the
rates collapse to a crisp 0 or 1.
"""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import (
    Account, AccountType, ConversionRule, ExpenseStream, Income,
    InflationModel, MarketModel, Profile, SimSettings,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _early_retiree(accounts, *, allow_early_trad=True, annual=30000, retire=45,
                   horizon=70) -> Scenario:
    s = Scenario(
        profile=Profile(birth_year=2026 - retire, horizon_age=horizon, state_tax_rate=0.0),
        accounts=accounts,
        income=Income(gross_salary=0),
        retirement_age=retire,
        expense_streams=[ExpenseStream(name="living", annual=annual, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    s.withdrawal_policy.allow_early_trad_with_penalty = allow_early_trad
    return s


def test_no_bridge_when_retiring_after_penalty_free_age():
    s = _early_retiree([Account(type=AccountType.cash, balance=500000)], retire=62)
    b = m.bridge_analysis(run(s))
    assert b["has_bridge"] is False
    assert "bridge_break_rate" not in b  # short-circuits before the distribution work


def test_locked_traditional_breaks_bridge_via_early_penalty():
    """Money trapped in traditional with last-resort early withdrawals on: no hard
    shortfall (trad is huge), but the bridge only survives by paying the 10%
    penalty — exactly the fragility a binary success rate hides."""
    s = _early_retiree(
        [Account(type=AccountType.trad_401k, balance=2_000_000),
         Account(type=AccountType.cash, balance=20000)],
        allow_early_trad=True)
    r = run(s)
    b = m.bridge_analysis(r)
    assert b["bridge_fail_rate"] == 0.0           # trad covers the need, so no shortfall
    assert b["early_penalty_rate"] == 1.0         # ...but only by paying the penalty
    assert b["bridge_break_rate"] == 1.0          # break captures the penalty-only case
    assert b["median_penalty_real"] > 0.0
    assert r.penalty_paid[:, : 60 - s.start_age].sum() > 0.0
    # most of the portfolio is penalty-locked entering retirement
    assert b["at_retirement"]["pct_accessible"] < 0.10


def test_locked_traditional_without_last_resort_fails_in_bridge():
    """Same trap, but last-resort early withdrawals off: the penalty-free money
    runs dry and the plan fails *inside the bridge window*, not late in life."""
    s = _early_retiree(
        [Account(type=AccountType.trad_401k, balance=2_000_000),
         Account(type=AccountType.cash, balance=20000)],
        allow_early_trad=False)
    b = m.bridge_analysis(run(s))
    assert b["bridge_fail_rate"] == 1.0
    assert b["longevity_fail_rate"] == 0.0        # the failure is the bridge, not longevity
    assert b["bridge_break_rate"] == 1.0
    assert b["early_penalty_rate"] == 0.0


def test_taxable_heavy_bridge_is_intact_and_well_covered():
    s = _early_retiree(
        [Account(type=AccountType.taxable, balance=2_000_000, cost_basis=2_000_000),
         Account(type=AccountType.cash, balance=50000)],
        annual=40000)
    b = m.bridge_analysis(run(s))
    assert b["bridge_break_rate"] == 0.0
    assert b["coverage_p50"] > 2.0                # accessible >> bridge spending
    assert b["runway_p50"] >= b["bridge_years"]   # more runway than the gap to 60
    assert b["at_retirement"]["pct_accessible"] > 0.95


def test_accessibility_fan_is_ordered_and_full_length():
    s = _early_retiree([Account(type=AccountType.taxable, balance=1_000_000,
                                cost_basis=1_000_000)])
    r = run(s)
    fan = m.accessibility_fan(r)
    T = r.ages.shape[0]
    assert set(fan) == {"p5", "p25", "p50", "p75", "p95"}
    assert all(len(v) == T for v in fan.values())
    for i in range(T):
        assert fan["p5"][i] <= fan["p50"][i] <= fan["p95"][i]


def test_crash_into_retirement_worsens_the_bridge():
    """A forced drawdown at the start of the bridge can only hurt: lower success,
    no fewer bridge breaks."""
    from fire_engine import example_scenario
    s = example_scenario()
    s.retirement_age = 50
    cs = m.bridge_crash_stress(s, drop=0.4, years=2, n_paths=400)
    assert cs["stressed_success"] <= cs["base_success"]
    assert cs["stressed_bridge_break_rate"] >= cs["base_bridge_break_rate"]
