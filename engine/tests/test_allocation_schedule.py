"""Age-based allocation glidepath: the portfolio mix shifts at chosen ages."""

import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account, AccountType, Allocation, AllocationSegment, Income, InflationModel,
    MarketModel, Profile, SimSettings,
)

# Deterministic returns: stocks compound 10%/yr real, bonds stay flat. Zero
# volatility/inflation/dividends so net-worth growth reads straight off the
# active allocation each year.
STOCKS_10 = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.10, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)

ALL_BONDS = Allocation(stocks=0.0, bonds=1.0, cash=0.0)
ALL_STOCKS = Allocation(stocks=1.0, bonds=0.0, cash=0.0)


def _holder(allocation, schedule, *, horizon=60) -> Scenario:
    # A retiree (from day one) holding a static taxable balance with no income or
    # expenses, so net worth changes only through portfolio growth at the active
    # allocation — nothing else moves the number.
    return Scenario(
        profile=Profile(birth_year=1976, horizon_age=horizon, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=100000, cost_basis=100000)],
        income=Income(gross_salary=0.0, real_growth=0.0, growth_mode="real"),
        retirement_age=50,  # 2026 - 1976 = age 50 at start: retired immediately
        expense_streams=[],
        allocation=allocation,
        allocation_schedule=schedule,
        sim=SimSettings(n_paths=2, start_year=2026),
        **STOCKS_10,
    )


def test_empty_schedule_uses_static_allocation():
    # 100% bonds (0% return) -> net worth stays flat across the horizon.
    nw_b = run(_holder(ALL_BONDS, [])).net_worth[0]
    assert nw_b[-1] == pytest.approx(nw_b[0], rel=1e-6)

    # 100% stocks at 10%/yr -> compounds well past 2x over ~11 years.
    nw_s = run(_holder(ALL_STOCKS, [])).net_worth[0]
    assert nw_s[-1] > nw_s[0] * 2.0


def test_glide_shifts_allocation_at_segment_age():
    """Bonds (flat) until age 55, then a glide to all-stocks starts compounding."""
    sched = [AllocationSegment(start_age=55, allocation=ALL_STOCKS)]
    nw = run(_holder(ALL_BONDS, sched)).net_worth[0]
    start_age = 50  # 2026 - 1976
    # net_worth is (P, T+1); index t is the balance entering sim-year start_age+t.
    idx_55 = 55 - start_age
    assert nw[idx_55] == pytest.approx(nw[0], rel=1e-6)  # flat through the bond years
    assert nw[-1] > nw[idx_55] * 1.4                     # ~6 years of 10% after the glide
