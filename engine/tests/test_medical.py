"""Dedicated medical_streams: HSA-eligible out-of-pocket spending, separate from
the general expense table but equivalent to the deprecated is_medical flag."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account, AccountType, ExpenseStream, HSARule, Income, InflationModel,
    MarketModel, Profile, SimSettings,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0}, dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def _retiree(expense_streams, medical_streams) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=44, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.hsa, balance=50000),
                  Account(type=AccountType.cash, balance=100000)],
        income=Income(gross_salary=0),
        retirement_age=40,
        expense_streams=expense_streams,
        medical_streams=medical_streams,
        hsa=HSARule(utilization=1.0, cash_buffer=0.0),
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )


def test_medical_stream_equivalent_to_is_medical_flag():
    """A dedicated medical stream must behave exactly like an essential is_medical
    expense stream — same HSA draw, same net worth."""
    flag = run(_retiree(
        [ExpenseStream(name="med", annual=5000, is_medical=True, essential=True,
                       inflates=False)], []))
    med = run(_retiree(
        [], [ExpenseStream(name="med", annual=5000, essential=True, inflates=False)]))
    assert np.allclose(flag.net_worth, med.net_worth)
    assert np.allclose(flag.pools["hsa"], med.pools["hsa"])


def test_medical_stream_drawn_from_hsa_tax_free():
    """With full utilization the HSA pays the medical bill; no other account is
    tapped and the HSA falls by exactly the medical amount each year."""
    r = run(_retiree([], [ExpenseStream(name="med", annual=5000, essential=True,
                                        inflates=False)]))
    # HSA: 50k -> 45k after paying 5k of medical (zero growth)
    assert r.pools["hsa"][0, 1] == pytest.approx(45000)
    # cash untouched (medical fully covered by the HSA, no other expenses)
    assert r.pools["cash"][0, 1] == pytest.approx(100000)
    # no taxable ordinary income from an HSA medical draw
    assert np.allclose(r.taxes_paid[:, 0], 0.0)
