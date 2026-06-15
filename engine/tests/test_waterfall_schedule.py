"""Time-varying contribution waterfall: routing changes at chosen ages."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account, AccountType, Income, InflationModel, MarketModel, Profile,
    SimSettings, WaterfallSegment, WaterfallStep,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _saver(schedule, *, salary=120000, horizon=56) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=horizon, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.cash, balance=0),
                  Account(type=AccountType.taxable, balance=0, cost_basis=0)],
        income=Income(gross_salary=salary, real_growth=0.0, growth_mode="real",
                      employer_match_pct=0.0),
        retirement_age=horizon,  # works the whole horizon but the last year
        expense_streams=[],
        waterfall=[WaterfallStep(account=AccountType.taxable, kind="max")],
        waterfall_schedule=schedule,
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )


def test_empty_schedule_routes_to_base_waterfall():
    r = run(_saver([]))
    # base waterfall sends all surplus to taxable; cash gets nothing
    assert r.contrib_pools["taxable"][0].sum() > 0.0
    assert r.contrib_pools["cash"][0].sum() == pytest.approx(0.0)


def test_routing_switches_at_segment_boundary():
    """Base waterfall -> taxable; from age 45 a segment reroutes surplus to cash."""
    sched = [WaterfallSegment(start_age=45,
                              steps=[WaterfallStep(account=AccountType.cash, kind="max")])]
    r = run(_saver(sched))
    start_age = 40  # 2026 - 1986
    tax = r.contrib_pools["taxable"][0]
    csh = r.contrib_pools["cash"][0]
    for t, age in enumerate(range(start_age, start_age + len(tax))):
        if age >= 56:
            continue  # retired: no wages, no contributions
        if age < 45:
            assert tax[t] > 0.0 and csh[t] == pytest.approx(0.0), f"age {age}"
        else:
            assert csh[t] > 0.0 and tax[t] == pytest.approx(0.0), f"age {age}"
