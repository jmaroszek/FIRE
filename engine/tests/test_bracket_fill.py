"""Bracket-filled (tax-aware) post-59½ decumulation.

Two layers: unit tests on `plan_withdrawals`'s cap + fallback mechanics, and
end-to-end engine tests that the traditional spending draw is held to the target
bracket, overflow spills to Roth, and the Roth conversion ladder fills exactly
the room the spending draw leaves (the two levers share one ceiling). Run
zero-growth / zero-inflation so the fixed point converges to crisp numbers.
"""

import numpy as np
import pytest

from fire_engine import Scenario, run
from fire_engine.accounts import PortfolioState, plan_withdrawals
from fire_engine.taxes import load_tax_tables, ordinary_bracket_top
from fire_engine.scenario import (
    Account, AccountType, ConversionRule, ExpenseStream, Income,
    InflationModel, MarketModel, Profile, SimSettings, WithdrawalSource,
)

NO_GROWTH = dict(
    market=MarketModel(mode="parametric",
                       stocks={"real_cagr": 0.0, "vol": 0.0},
                       bonds={"real_cagr": 0.0, "vol": 0.0},
                       cash={"real_cagr": 0.0, "vol": 0.0},
                       dividend_yield=0.0),
    inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
)

# A full 59½-and-after preference order: traditional/HSA sit ahead of Roth, so
# capping them routes the overflow straight to the Roth sources behind them.
LATE = [WithdrawalSource.cash, WithdrawalSource.taxable, WithdrawalSource.trad,
        WithdrawalSource.hsa, WithdrawalSource.roth_matured_conversions,
        WithdrawalSource.roth_basis, WithdrawalSource.roth_earnings]


def make_state(**balances) -> PortfolioState:
    accounts = []
    for key, value in balances.items():
        if key == "taxable":
            accounts.append(Account(type=AccountType.taxable, balance=value[0], cost_basis=value[1]))
        elif key == "roth":
            accounts.append(Account(type=AccountType.roth_ira, balance=value[0],
                                    roth_contribution_basis=value[1]))
        elif key == "trad":
            accounts.append(Account(type=AccountType.trad_401k, balance=value))
        else:
            accounts.append(Account(type=AccountType(key), balance=value))
    return PortfolioState(Scenario(accounts=accounts), n_paths=1)


# ---- unit: plan_withdrawals cap + fallback ---------------------------------

def test_bracket_cap_spills_overflow_to_roth():
    state = make_state(trad=200000.0, roth=(100000.0, 100000.0))
    plan = plan_withdrawals(state, np.array([40000.0]), age=65, order=LATE,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False,
                            trad_ordinary_cap=np.array([15000.0]))
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(15000.0)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(25000.0)
    assert plan.ordinary_income[0] == pytest.approx(15000.0)
    assert plan.shortfall[0] == pytest.approx(0.0)


def test_bracket_cap_loose_uses_only_trad():
    # cap above the need: traditional funds it all, Roth is never touched
    state = make_state(trad=200000.0, roth=(100000.0, 100000.0))
    plan = plan_withdrawals(state, np.array([40000.0]), age=65, order=LATE,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False,
                            trad_ordinary_cap=np.array([60000.0]))
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(40000.0)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(0.0)


def test_bracket_cap_fallback_to_trad_when_roth_dry():
    # capped trad 15k + all 10k of Roth basis = 25k; the last 15k has nowhere to
    # go but uncapped traditional — a funded year beats a smooth one.
    state = make_state(trad=200000.0, roth=(10000.0, 10000.0))
    plan = plan_withdrawals(state, np.array([40000.0]), age=65, order=LATE,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False,
                            trad_ordinary_cap=np.array([15000.0]))
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(30000.0)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(10000.0)
    assert plan.ordinary_income[0] == pytest.approx(30000.0)
    assert plan.shortfall[0] == pytest.approx(0.0)


def test_bracket_cap_forced_ordinary_consumes_headroom():
    # a forced 10k traditional distribution is ordinary income too, so it eats
    # the headroom first: only 5k of discretionary trad fits before Roth.
    state = make_state(trad=200000.0, roth=(100000.0, 100000.0))
    plan = plan_withdrawals(state, np.array([20000.0]), age=65, order=LATE,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False,
                            forced={WithdrawalSource.trad: np.array([10000.0])},
                            trad_ordinary_cap=np.array([15000.0]))
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(15000.0)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(15000.0)
    assert plan.ordinary_income[0] == pytest.approx(15000.0)


def test_no_cap_reproduces_priority_order():
    # trad_ordinary_cap=None is the strict-order path: trad drains before Roth
    state = make_state(trad=200000.0, roth=(100000.0, 100000.0))
    plan = plan_withdrawals(state, np.array([40000.0]), age=65, order=LATE,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False)
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(40000.0)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(0.0)


# ---- integration: engine end-to-end ---------------------------------------

def _post60_retiree(mode, *, annual=100000, conversion=None) -> Scenario:
    s = Scenario(
        profile=Profile(birth_year=2026 - 62, horizon_age=70, state_tax_rate=0.0),
        accounts=[
            Account(type=AccountType.trad_401k, balance=2_000_000),
            Account(type=AccountType.roth_ira, balance=600_000, roth_contribution_basis=600_000),
            Account(type=AccountType.cash, balance=0),
        ],
        income=Income(gross_salary=0),
        retirement_age=62,
        expense_streams=[ExpenseStream(name="living", annual=annual, inflates=False)],
        conversion_rule=conversion or ConversionRule(kind="none"),
        sim=SimSettings(n_paths=2, start_year=2026),
        **NO_GROWTH,
    )
    s.withdrawal_policy.cash_buffer = 0.0
    s.withdrawal_policy.mode = mode
    s.withdrawal_policy.bracket_top = "12"
    return s


def _ceiling_12() -> float:
    tables = load_tax_tables()
    return float(ordinary_bracket_top("12", tables, 1.0)) + float(tables.standard_deduction)


def test_bracket_fill_caps_trad_and_taps_roth():
    ceiling = _ceiling_12()
    bf = run(_post60_retiree("bracket_filled"))
    pr = run(_post60_retiree("priority"))

    # first retirement year (age 62, before Social Security): no other income, so
    # the cap equals the bracket ceiling exactly.
    trad_bf, roth_bf = bf.withdrawals["trad"][0, 0], bf.withdrawals["roth_basis"][0, 0]
    trad_pr, roth_pr = pr.withdrawals["trad"][0, 0], pr.withdrawals["roth_basis"][0, 0]

    # bracket-fill: traditional draw pinned at the ceiling, the rest from Roth
    assert trad_bf == pytest.approx(ceiling, abs=50.0)
    assert roth_bf > 0.0
    # priority: traditional covers the whole need, Roth untouched
    assert trad_pr > ceiling
    assert roth_pr == pytest.approx(0.0)
    # neither mode loses money or leans on the penalty post-60
    assert bf.success_rate == 1.0 and pr.success_rate == 1.0


def test_bracket_fill_and_ladder_share_one_ceiling():
    # modest spend under the ceiling, with the ladder also filling to 12%: the
    # spending draw plus the conversion should top out ordinary income at the
    # same ceiling, and Roth should stay untouched.
    ceiling = _ceiling_12()
    s = _post60_retiree("bracket_filled", annual=30000,
                        conversion=ConversionRule(kind="fill_bracket", bracket_top="12",
                                                  start_age=62, end_age=70))
    r = run(s)
    trad, conv, roth = (r.withdrawals["trad"][0, 0], r.conversions[0, 0],
                        r.withdrawals["roth_basis"][0, 0])
    # Spending draw + conversion top out at one shared ceiling — not two (which
    # would be ~2x). The small overshoot is the existing fixed-point lag: the
    # conversion target reads the prior iteration's trad draw, so it trails by
    # one step's change rather than landing exactly. ~0.6% here.
    assert trad + conv == pytest.approx(ceiling, rel=0.02)
    assert trad + conv < 1.5 * ceiling      # decisively one ceiling, not double-filled
    assert conv > 0.0                       # the ladder used the room spending left
    assert roth == pytest.approx(0.0)       # spending stayed under the ceiling
