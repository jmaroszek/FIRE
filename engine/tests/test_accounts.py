"""Account pool mechanics: Roth ordering, conversion seasoning, withdrawal
planning, waterfall limits."""

import numpy as np
import pytest

from fire_engine.accounts import PortfolioState, apply_plan, plan_withdrawals
from fire_engine.engine import _allocate_waterfall, _contribution_limits
from fire_engine.scenario import (
    Account,
    AccountType,
    Scenario,
    WithdrawalSource,
    default_waterfall,
)


def make_state(**balances) -> PortfolioState:
    accounts = []
    for key, value in balances.items():
        if key == "taxable":
            accounts.append(Account(type=AccountType.taxable, balance=value[0],
                                    cost_basis=value[1]))
        elif key == "roth":
            accounts.append(Account(type=AccountType.roth_ira, balance=value[0],
                                    roth_contribution_basis=value[1]))
        elif key == "trad":
            accounts.append(Account(type=AccountType.trad_401k, balance=value))
        else:
            accounts.append(Account(type=AccountType(key), balance=value))
    scenario = Scenario(accounts=accounts)
    return PortfolioState(scenario, n_paths=1)


ORDER = default_waterfall()  # not used in withdrawal tests


def test_conversion_seasons_after_five_years():
    state = make_state(trad=100000.0)
    state.convert(np.array([20000.0]), t=0)
    assert state.trad[0] == pytest.approx(80000.0)
    assert state.conv_total[0] == pytest.approx(20000.0)
    for t in range(1, 5):
        state.season_conversions(t)
        assert state.conv_matured[0] == 0.0
    state.season_conversions(5)
    assert state.conv_matured[0] == pytest.approx(20000.0)


def test_preexisting_conversions_schedule():
    scenario = Scenario(accounts=[
        Account(type=AccountType.roth_ira, balance=50000,
                roth_conversions={2020: 10000, 2023: 5000}),
    ])
    state = PortfolioState(scenario, n_paths=1)
    # 2020 conversion matured in 2025 (< start 2026); 2023 matures in 2028 = t 2
    assert state.conv_matured[0] == pytest.approx(10000.0)
    state.season_conversions(2)
    assert state.conv_matured[0] == pytest.approx(15000.0)


def test_withdrawal_order_and_gains():
    state = make_state(cash=20000.0, taxable=(50000.0, 30000.0))
    policy_order = [WithdrawalSource.cash, WithdrawalSource.taxable]
    plan = plan_withdrawals(state, np.array([40000.0]), age=40, order=policy_order,
                            cash_buffer_nominal=np.array([10000.0]),
                            allow_early_trad=False)
    # 10k from cash (buffer keeps 10k), 30k from taxable
    assert plan.takes[WithdrawalSource.cash][0] == pytest.approx(10000.0)
    assert plan.takes[WithdrawalSource.taxable][0] == pytest.approx(30000.0)
    # gain fraction = (50k-30k)/50k = 0.4 -> 12k realized gains
    assert plan.ltcg_income[0] == pytest.approx(12000.0)
    assert plan.shortfall[0] == pytest.approx(0.0)
    apply_plan(state, plan, age=40)
    assert state.taxable[0] == pytest.approx(20000.0)
    assert state.taxable_basis[0] == pytest.approx(30000.0 * (1 - 30000 / 50000))


def test_roth_ordering_and_early_trad_penalty():
    state = make_state(roth=(50000.0, 20000.0), trad=100000.0)
    state.conv_total = np.array([10000.0])
    state.conv_matured = np.array([10000.0])
    order = [WithdrawalSource.roth_basis, WithdrawalSource.roth_matured_conversions,
             WithdrawalSource.trad]
    plan = plan_withdrawals(state, np.array([60000.0]), age=45, order=order,
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=True)
    assert plan.takes[WithdrawalSource.roth_basis][0] == pytest.approx(20000.0)
    assert plan.takes[WithdrawalSource.roth_matured_conversions][0] == pytest.approx(10000.0)
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(30000.0)
    assert plan.ordinary_income[0] == pytest.approx(30000.0)
    assert plan.penalty_base[0] == pytest.approx(30000.0)  # age < 60


def test_early_trad_blocked_when_disallowed():
    state = make_state(trad=100000.0)
    plan = plan_withdrawals(state, np.array([10000.0]), age=45,
                            order=[WithdrawalSource.trad],
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False)
    assert plan.takes[WithdrawalSource.trad][0] == 0.0
    assert plan.shortfall[0] == pytest.approx(10000.0)


def test_trad_unrestricted_at_60():
    state = make_state(trad=100000.0)
    plan = plan_withdrawals(state, np.array([10000.0]), age=60,
                            order=[WithdrawalSource.trad],
                            cash_buffer_nominal=np.array([0.0]), allow_early_trad=False)
    assert plan.takes[WithdrawalSource.trad][0] == pytest.approx(10000.0)
    assert plan.penalty_base[0] == 0.0


def test_waterfall_limits_and_match():
    infl = np.array([1.0])
    limits = _contribution_limits(age=26, infl=infl, coverage="self_only")
    wages = np.array([110000.0])
    available = np.array([60000.0])
    contrib, pretax, match = _allocate_waterfall(
        available, default_waterfall(), limits, match_pct=0.04, wages=wages, infl=infl)
    assert contrib[AccountType.hsa][0] == pytest.approx(4400.0)
    assert contrib[AccountType.roth_ira][0] == pytest.approx(7500.0)
    # to_match 4,400 + max step (24,500 - 4,400) = 24,500 total employee 401k
    assert contrib[AccountType.trad_401k][0] == pytest.approx(24500.0)
    assert contrib[AccountType.taxable][0] == pytest.approx(60000 - 24500 - 4400 - 7500)
    assert pretax[0] == pytest.approx(24500 + 4400)
    assert match[0] == pytest.approx(0.04 * 110000)


def test_waterfall_catchup_limits():
    infl = np.array([1.0])
    lim50 = _contribution_limits(age=50, infl=infl, coverage="self_only")
    assert lim50["401k"][0] == pytest.approx(24500 + 8000)
    assert lim50["ira"][0] == pytest.approx(7500 + 1100)
    lim61 = _contribution_limits(age=61, infl=infl, coverage="self_only")
    assert lim61["401k"][0] == pytest.approx(24500 + 11250)
    lim56 = _contribution_limits(age=56, infl=infl, coverage="self_only")
    assert lim56["hsa"][0] == pytest.approx(4400 + 1000)


def test_waterfall_scarce_cash_respects_order():
    infl = np.array([1.0])
    limits = _contribution_limits(age=26, infl=infl, coverage="self_only")
    contrib, _, _ = _allocate_waterfall(
        np.array([6000.0]), default_waterfall(), limits,
        match_pct=0.04, wages=np.array([100000.0]), infl=infl)
    # match first (4,000), then HSA gets the remaining 2,000
    assert contrib[AccountType.trad_401k][0] == pytest.approx(4000.0)
    assert contrib[AccountType.hsa][0] == pytest.approx(2000.0)
    assert contrib[AccountType.roth_ira][0] == pytest.approx(0.0)
