"""Liabilities: amortization, expense coupling, net-worth netting; plus
sustained-crossing years_to_fi and the investing series."""

import numpy as np

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.engine import _liability_schedule
from fire_engine.scenario import (
    Account,
    AccountType,
    ExpenseStream,
    Income,
    Liability,
    Profile,
    SimSettings,
)


def base_scenario(**kw) -> Scenario:
    defaults = dict(
        profile=Profile(birth_year=1990, horizon_age=70, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=500000, cost_basis=500000)],
        income=Income(gross_salary=100000, real_growth=0.0, growth_mode="real"),
        retirement_age=60,
        expense_streams=[ExpenseStream(name="Living", annual=40000)],
        sim=SimSettings(n_paths=4, seed=1, start_year=2026),
    )
    defaults.update(kw)
    return Scenario(**defaults)


def test_amortization_zero_interest():
    s = base_scenario(liabilities=[
        Liability(name="Car", balance=30000, interest_rate=0.0, annual_payment=10000)])
    payments, balance = _liability_schedule(s, 10)
    assert np.allclose(payments[:3], 10000) and np.allclose(payments[3:], 0)
    assert np.allclose(balance[:4], [30000, 20000, 10000, 0])
    assert balance[-1] == 0


def test_amortization_with_interest_payoff():
    # 200k at 5%, paying 20k/yr: balance grows by interest then shrinks
    s = base_scenario(liabilities=[
        Liability(name="Mortgage", balance=200000, interest_rate=0.05,
                  annual_payment=20000)])
    payments, balance = _liability_schedule(s, 40)
    assert balance[1] == 200000 * 1.05 - 20000
    # closed-form payoff is ~15 years; final payment is partial
    paid_years = int((payments > 0).sum())
    assert 14 <= paid_years <= 16
    assert payments[paid_years - 1] < 20000  # last payment partial
    assert balance[-1] == 0
    # total paid exceeds principal (interest) but is bounded
    assert 200000 < payments.sum() < 200000 * 1.6


def test_net_worth_netted_and_payments_are_expenses():
    plain = base_scenario()
    loan = base_scenario(liabilities=[
        Liability(name="Loan", balance=50000, interest_rate=0.0, annual_payment=5000)])
    r0 = run(plain, deterministic=True)
    r1 = run(loan, deterministic=True)
    # at t=0 the full balance is netted out
    assert np.allclose(r1.net_worth[:, 0], r0.net_worth[:, 0] - 50000)
    # payments raise expenses by exactly 5k/yr while the loan lives
    assert np.allclose(r1.expenses[:, 0] - r0.expenses[:, 0], 5000)
    assert np.allclose(r1.expenses[:, 9] - r0.expenses[:, 9], 5000)
    assert np.allclose(r1.expenses[:, 10], r0.expenses[:, 10])
    assert r1.liability_balance[10] == 0


def test_years_to_fi_requires_sustained_crossing():
    sweep = {40: 0.5, 41: 0.95, 42: 0.97, 43: 0.6, 44: 0.91, 45: 0.93}
    assert m.years_to_fi(sweep, 0.90, 30) == 14  # age 44, not the 41-42 peak
    assert m.years_to_fi({40: 0.5, 41: 0.95}, 0.90, 30) == 11
    assert m.years_to_fi({40: 0.5, 41: 0.8}, 0.90, 30) is None


def test_investing_series_matches_total_contributions():
    s = base_scenario()
    r = run(s, deterministic=True)
    total = sum(r.contrib_pools.values())
    assert np.allclose(total, r.contributions)
    inv = m.investing_medians_real(r)
    assert set(inv) == {"taxable", "trad", "roth", "hsa", "cash", "match"}
    # working years save something, retirement years don't
    year_totals = np.array([sum(v[t] for v in inv.values())
                            for t in range(len(r.ages))])
    assert year_totals[0] > 0
    assert np.allclose(year_totals[r.ages >= 60], 0.0, atol=1.0)
