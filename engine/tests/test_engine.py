"""End-to-end engine tests: closed-form checks, ladder, RMD, Trinity
replication, and the performance budget."""

import time

import numpy as np
import pytest

from fire_engine import Scenario, example_scenario, run
from fire_engine.scenario import (
    Account,
    AccountType,
    ConversionRule,
    ExpenseStream,
    Income,
    InflationModel,
    MarketModel,
    Profile,
    SimSettings,
)

FROZEN_MARKET = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.05, "vol": 0.0},
                       bonds={"real_cagr": 0.05, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)


def test_compound_growth_closed_form():
    """No income, no expenses, 5% return, zero inflation -> exact compounding."""
    s = Scenario(
        profile=Profile(birth_year=1990, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=100000, cost_basis=100000)],
        income=Income(gross_salary=0),
        retirement_age=36,
        expense_streams=[],
        sim=SimSettings(n_paths=4, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    T = s.n_years
    expected = 100000 * 1.05 ** np.arange(T + 1)
    assert np.allclose(result.net_worth[0], expected, rtol=1e-9)
    assert result.success_rate == 1.0


def test_spend_down_exact_and_failure_year():
    """1M Roth basis, 40k/yr, 0% return: exactly 25 years of spending, then failure."""
    s = Scenario(
        profile=Profile(birth_year=1961, horizon_age=90, state_tax_rate=0.05),
        accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                          roth_contribution_basis=1_000_000)],
        income=Income(gross_salary=0),
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=40000)],
        sim=SimSettings(n_paths=4, start_year=2026),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.0, "vol": 0.0},
                           bonds={"real_cagr": 0.0, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )
    result = run(s)
    # T = 90-65+1 = 26 years; balance hits exactly 0 after 25 withdrawals
    assert np.allclose(result.net_worth[0, :26], 1_000_000 - 40000 * np.arange(26))
    assert not result.fail[0, :25].any()
    assert result.fail[0, 25]  # 26th year of spending has nothing left
    assert result.success_rate == 0.0


def test_roth_basis_withdrawals_are_tax_free():
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=50, state_tax_rate=0.05),
        accounts=[Account(type=AccountType.roth_ira, balance=500000,
                          roth_contribution_basis=500000)],
        retirement_age=40,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    assert np.allclose(result.taxes_paid, 0.0)


def test_conversion_ladder_fills_standard_deduction():
    """Retiree converting to the top of the standard deduction: 16,100/yr, zero tax,
    rungs season after 5 years. (State rate 0 here: a flat state tax correctly
    taxes realized gains that the federal 0% LTCG bracket ignores, which would
    muddy the hand-math.)"""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=60, state_tax_rate=0.0),
        accounts=[
            Account(type=AccountType.trad_401k, balance=500000),
            Account(type=AccountType.taxable, balance=600000, cost_basis=600000),
        ],
        retirement_age=40,
        expense_streams=[ExpenseStream(name="living", annual=40000)],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="std_deduction"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    # converts exactly the standard deduction every ladder year, tax-free
    assert result.conversions[0, 0] == pytest.approx(16100.0)
    assert result.conversions[0, 5] == pytest.approx(16100.0)
    assert np.allclose(result.taxes_paid[0, :5], 0.0, atol=1e-6)
    # first rung seasons at t=5; by end of t=6 two rungs are accessible
    assert result.accessible["roth_matured_conversions"][0, 4] == pytest.approx(0.0)
    assert result.accessible["roth_matured_conversions"][0, 5] == pytest.approx(16100.0)
    assert result.accessible["roth_matured_conversions"][0, 6] == pytest.approx(32200.0)


def test_conversion_ladder_fill_12_bracket_pays_tax():
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=50, state_tax_rate=0.0),
        accounts=[
            Account(type=AccountType.trad_401k, balance=800000),
            Account(type=AccountType.taxable, balance=400000, cost_basis=400000),
        ],
        retirement_age=40,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="12"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    # converts std deduction + top of 12% bracket = 16,100 + 50,400 = 66,500
    assert result.conversions[0, 0] == pytest.approx(66500.0)
    # tax = 12,400*10% + (50,400-12,400)*12% = 5,800
    assert result.taxes_paid[0, 0] == pytest.approx(5800.0)


def test_conversion_ladder_runs_past_59_5_by_default():
    """The ladder is a lifetime tool: with the default window it keeps converting
    well past 59½ (here at 65) to shrink the pre-RMD traditional balance."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=70, state_tax_rate=0.0),
        accounts=[
            Account(type=AccountType.trad_401k, balance=2_000_000),
            Account(type=AccountType.roth_ira, balance=500000, roth_contribution_basis=500000),
        ],
        retirement_age=50,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="12"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    age65 = 65 - s.start_age
    assert result.conversions[0, age65] > 1.0  # still laddering at 65 (default end 72)


def test_conversion_marginal_rate_reports_next_dollar_bracket():
    """The 'Next $ Taxed At' readout: filling to the standard deduction leaves the
    next conversion dollar landing in the bottom 10% bracket (no SS, no state tax,
    no gains in play)."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=50, state_tax_rate=0.0),
        accounts=[
            Account(type=AccountType.trad_401k, balance=500000),
            Account(type=AccountType.taxable, balance=600000, cost_basis=600000),
        ],
        retirement_age=40,
        expense_streams=[ExpenseStream(name="living", annual=40000)],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="std_deduction"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    assert result.conversion_marginal_rate[0, 0] == pytest.approx(0.10, abs=1e-6)


def test_rmd_forced_at_75():
    s = Scenario(
        profile=Profile(birth_year=1951, horizon_age=80, state_tax_rate=0.05),
        accounts=[Account(type=AccountType.trad_ira, balance=1_000_000)],
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        sim=SimSettings(n_paths=2, start_year=2026),
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.0, "vol": 0.0},
                           bonds={"real_cagr": 0.0, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0},
                           dividend_yield=0.0),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )
    result = run(s)
    rmd = 1_000_000 / 24.6
    assert result.rmds[0, 0] == pytest.approx(rmd)
    assert result.pools["trad"][0, 1] == pytest.approx(1_000_000 - rmd)
    # RMD is ordinary income: taxable = rmd - 16,100
    taxable = rmd - 16100
    fed = 12400 * 0.10 + (taxable - 12400) * 0.12
    state_tax = 0.05 * taxable
    assert result.taxes_paid[0, 0] == pytest.approx(fed + state_tax, rel=1e-6)
    # excess RMD beyond spending+tax lands in the taxable account
    leftover = rmd - 30000 - (fed + state_tax)
    assert result.pools["taxable"][0, 1] == pytest.approx(leftover, rel=1e-6)


def test_rmd_schedule_metric():
    """The RMD tile's data: first year's distribution = balance / divisor, with a
    marginal-rate diagnostic on the same income."""
    from fire_engine.metrics import rmd_schedule
    s = Scenario(
        profile=Profile(birth_year=1951, horizon_age=80, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.trad_ira, balance=1_000_000)],
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    rows = rmd_schedule(run(s))
    assert rows[0]["age"] == 75  # RMDs begin the year you turn 75
    assert rows[0]["amount_real"] == pytest.approx(1_000_000 / 24.6, rel=1e-6)
    assert 0.0 <= rows[0]["marginal_rate"] <= 1.0


def test_custom_conversion_target_between_brackets():
    """A custom fill target lands between the named brackets: it converts more
    than the 12% top but less than the 22% top in the same scenario."""
    def trad_at_72(bracket_top, custom=0.0):
        s = Scenario(
            profile=Profile(birth_year=1999, horizon_age=90, state_tax_rate=0.05),
            accounts=[Account(type=AccountType.trad_401k, balance=1_400_000),
                      Account(type=AccountType.taxable, balance=1_500_000, cost_basis=1_300_000)],
            retirement_age=45,
            expense_streams=[ExpenseStream(name="living", annual=50000, essential=True)],
            conversion_rule=ConversionRule(kind="fill_bracket", bracket_top=bracket_top, custom_top=custom),
            sim=SimSettings(n_paths=2, start_year=2026),
            **FROZEN_MARKET,
        )
        r = run(s)
        t = list(r.ages).index(72)
        return r.pools["trad"][0, t + 1] / r.cum_inflation[0, t + 1]
    low = trad_at_72("12")
    mid = trad_at_72("custom", 80000)
    high = trad_at_72("22")
    assert high < mid < low  # custom drains more than 12%, less than 22%


def test_social_security_haircut_and_claiming():
    s = Scenario(
        profile=Profile(birth_year=1961, horizon_age=72, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=2_000_000,
                          roth_contribution_basis=2_000_000)],
        retirement_age=65,
        expense_streams=[ExpenseStream(name="living", annual=40000)],
        social_security={"monthly_at_fra": 2000, "claiming_age": 67, "haircut": 0.75},
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    age67 = 67 - s.start_age
    assert np.allclose(result.ss_income[:, age67 - 1], 0.0)
    assert result.ss_income[0, age67] == pytest.approx(2000 * 12 * 0.75)


def test_social_security_not_taxed_when_provisional_income_low():
    """SS taxation follows the provisional-income test, not a flat 85%. A retiree
    funded only by (tax-free) Roth with a $40k benefit has provisional income
    0.5*40k = $20k, below the $25k base, so NONE of the benefit is taxed and
    federal tax is zero — a flat-85% model would instead tax 0.85*40k = $34k of
    ordinary income (≈$1,900 of federal tax after the standard deduction)."""
    s = Scenario(
        profile=Profile(birth_year=1959, horizon_age=68, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                          roth_contribution_basis=1_000_000)],
        income=Income(gross_salary=0),
        retirement_age=67,
        expense_streams=[ExpenseStream(name="living", annual=50000)],
        social_security={"monthly_at_fra": 40000 / 12, "claiming_age": 67, "haircut": 1.0},
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    t0 = 67 - s.start_age
    assert result.ss_income[0, t0] == pytest.approx(40000.0)
    assert result.taxes_paid[0, t0] == pytest.approx(0.0, abs=1.0)


def test_social_security_torpedo_partial_taxation():
    """Other ordinary income drags part of the benefit into tax. Age-75 retiree,
    $30k RMD ($738k trad / 24.6) + $40k SS, no other income, zero inflation:
        provisional = 30,000 + 0.5*40,000 = 50,000 > $34k upper threshold
        taxable SS  = min(0.85*40k, 0.85*(50k-34k) + min(0.5*40k, 4,500))
                    = min(34,000, 13,600 + 4,500) = 18,100   (partial, not the cap)
        ordinary    = 30,000 + 18,100 = 48,100; taxable = 48,100 - 16,100 = 32,000
        federal tax = 12,400*10% + 19,600*12% = 3,592
    """
    s = Scenario(
        profile=Profile(birth_year=1951, horizon_age=76, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.trad_ira, balance=738000)],  # RMD = 738000/24.6 = 30000
        income=Income(gross_salary=0),
        retirement_age=70,
        expense_streams=[ExpenseStream(name="living", annual=30000)],
        social_security={"monthly_at_fra": 40000 / 12, "claiming_age": 67, "haircut": 1.0},
        sim=SimSettings(n_paths=2, start_year=2026),
        **FROZEN_MARKET,
    )
    result = run(s)
    t0 = 75 - s.start_age
    assert result.ss_income[0, t0] == pytest.approx(40000.0)
    assert result.taxes_paid[0, t0] == pytest.approx(3592.0, abs=1.0)


def test_trinity_replication_bootstrap():
    """4% rule, 30 years, 75/25, tax-free portfolio: success should land in the
    ballpark of the historical SWR literature, and 6% must be far worse."""
    def scenario(spend):
        return Scenario(
            profile=Profile(birth_year=1961, horizon_age=94, state_tax_rate=0.0),
            accounts=[Account(type=AccountType.roth_ira, balance=1_000_000,
                              roth_contribution_basis=1_000_000)],
            allocation={"stocks": 0.75, "bonds": 0.25, "cash": 0.0},
            retirement_age=65,
            expense_streams=[ExpenseStream(name="living", annual=spend)],
            sim=SimSettings(n_paths=800, seed=7, start_year=2026),
        )

    s4 = run(scenario(40000)).success_rate
    s6 = run(scenario(60000)).success_rate
    assert 0.88 <= s4 <= 1.0, f"4% rule success {s4:.3f} outside expected band"
    assert s6 < s4 - 0.10, f"6% ({s6:.3f}) should be much worse than 4% ({s4:.3f})"


def test_higher_equity_higher_median():
    base = example_scenario()
    base.sim.n_paths = 400
    aggressive = base.model_copy(deep=True)
    aggressive.allocation = type(base.allocation)(stocks=1.0, bonds=0.0, cash=0.0)
    conservative = base.model_copy(deep=True)
    conservative.allocation = type(base.allocation)(stocks=0.2, bonds=0.8, cash=0.0)
    med_a = np.median(run(aggressive).net_worth[:, -1])
    med_c = np.median(run(conservative).net_worth[:, -1])
    assert med_a > med_c


def test_two_phase_withdrawal_order_selects_by_age():
    from fire_engine.accounts import PENALTY_FREE_AGE
    from fire_engine.scenario import WithdrawalPolicy, WithdrawalSource

    p = WithdrawalPolicy()
    assert p.order_for_age(45, PENALTY_FREE_AGE) is p.order
    assert p.order_for_age(60, PENALTY_FREE_AGE) is p.late_order
    # 59.5+ default taps traditional before Roth contributions; pre-59.5 is the
    # reverse (traditional is penalty-locked, so Roth funds the bridge).
    assert p.late_order.index(WithdrawalSource.trad) < \
        p.late_order.index(WithdrawalSource.roth_basis)
    assert p.order.index(WithdrawalSource.roth_basis) < \
        p.order.index(WithdrawalSource.trad)


def test_late_order_trad_first_preserves_roth():
    """At 60+, a trad-first late order spends traditional and leaves the Roth to
    compound; a roth-first late order drains the Roth instead."""
    from fire_engine.scenario import WithdrawalSource

    def build():
        return Scenario(
            profile=Profile(birth_year=1966, horizon_age=90, state_tax_rate=0.0),
            accounts=[
                Account(type=AccountType.trad_401k, balance=500000),
                Account(type=AccountType.roth_ira, balance=500000,
                        roth_contribution_basis=500000),
            ],
            income=Income(gross_salary=0),
            retirement_age=60,
            # under the standard deduction, so the trad draw carries no tax and
            # the comparison is exact
            expense_streams=[ExpenseStream(name="living", annual=12000)],
            sim=SimSettings(n_paths=4, start_year=2026),
            market=MarketModel(mode="parametric",
                               stocks={"real_cagr": 0.0, "vol": 0.0},
                               bonds={"real_cagr": 0.0, "vol": 0.0},
                               cash={"real_cagr": 0.0, "vol": 0.0},
                               dividend_yield=0.0),
            inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
        )

    trad_first = build()
    trad_first.withdrawal_policy.late_order = [
        WithdrawalSource.cash, WithdrawalSource.taxable, WithdrawalSource.trad,
        WithdrawalSource.hsa, WithdrawalSource.roth_matured_conversions,
        WithdrawalSource.roth_basis, WithdrawalSource.roth_earnings,
    ]
    roth_first = build()
    roth_first.withdrawal_policy.late_order = [
        WithdrawalSource.cash, WithdrawalSource.taxable, WithdrawalSource.roth_basis,
        WithdrawalSource.roth_matured_conversions, WithdrawalSource.trad,
        WithdrawalSource.hsa, WithdrawalSource.roth_earnings,
    ]
    rt = run(trad_first)
    rr = run(roth_first)
    c = 10  # after 10 yearly withdrawals (ages 60-69)
    assert rt.pools["trad"][0, c] == pytest.approx(500000 - 12000 * c)
    assert rt.pools["roth"][0, c] == pytest.approx(500000)  # roth untouched
    assert rr.pools["roth"][0, c] == pytest.approx(500000 - 12000 * c)
    assert rt.pools["roth"][0, c] > rr.pools["roth"][0, c]  # trad-first keeps more roth


def test_performance_budget():
    s = example_scenario()
    s.sim.n_paths = 2000
    run(s)  # warm caches
    start = time.perf_counter()
    run(s)
    elapsed = time.perf_counter() - start
    print(f"\n2000 paths x {s.n_years} years: {elapsed*1000:.0f} ms")
    assert elapsed < 0.6, f"engine too slow for interactive use: {elapsed:.2f}s"
