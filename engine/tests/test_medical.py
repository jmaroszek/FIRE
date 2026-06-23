"""Dedicated medical_streams: HSA-eligible out-of-pocket spending, separate from
the general expense table but equivalent to the deprecated is_medical flag."""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import (
    Account, AccountType, ExpenseStream, HSARule, Income, InflationModel,
    LTCConfig, MarketModel, Profile, SimSettings,
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


def _ltc_retiree(ltc: LTCConfig) -> Scenario:
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=44, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.hsa, balance=50000),
                  Account(type=AccountType.cash, balance=100000)],
        income=Income(gross_salary=0),
        retirement_age=40,
        expense_streams=[],
        medical_streams=[],
        hsa=HSARule(utilization=1.0, cash_buffer=0.0),
        ltc=ltc,
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )


def test_ltc_adds_essential_medical_in_window_only():
    """Enabled LTC adds an essential, HSA-paid medical expense over its window
    and nothing outside it."""
    # start_age = 2026 - 1986 = 40; ages 40..44 -> indices 0..4. LTC at 42, 43.
    r = run(_ltc_retiree(LTCConfig(enabled=True, onset_age=42, duration_years=2,
                                   annual_cost=20000, extra_inflation=0.0)))
    assert r.expenses[0, 0] == pytest.approx(0.0)      # age 40, before window
    assert r.expenses[0, 2] == pytest.approx(20000.0)  # age 42, in window
    assert r.expenses[0, 3] == pytest.approx(20000.0)  # age 43, in window
    assert r.expenses[0, 4] == pytest.approx(0.0)      # age 44, past window
    # paid tax-free from the HSA: 50k -> 30k (end age 42) -> 10k (end age 43)
    assert r.pools["hsa"][0, 3] == pytest.approx(30000)
    assert r.pools["hsa"][0, 4] == pytest.approx(10000)


def test_ltc_disabled_is_baseline():
    """LTC off (even with a cost set) adds no expense."""
    off = run(_ltc_retiree(LTCConfig(enabled=False, annual_cost=20000)))
    assert np.allclose(off.expenses, 0.0)
