"""The headline planning numbers: annual retirement expenses, the simple 25x
FIRE number, the Coast-FIRE number, and the Monte-Carlo FIRE number.

The deterministic three (expenses / simple FIRE / coast) are hand-computed. The
Monte-Carlo number is a bisection, so it's pinned by its *defining property*: the
balance it returns just barely funds retiring immediately (success >= threshold),
while a meaningfully smaller balance does not. A zero-volatility market makes that
knife-edge crisp — every path is identical, so success is a clean step function.
"""

import pytest

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import (
    Account, AccountType, Allocation, ConversionRule, ExpenseStream, Income,
    InflationModel, MarketModel, Profile, SimSettings,
)


def _flat_market(stocks: float, bonds: float = 0.0, cash: float = 0.0) -> MarketModel:
    """Vol-free market with the given real CAGRs — coast_fire reads these CAGRs
    directly, and a zero-vol market makes the MC bisection deterministic."""
    return MarketModel(
        mode="parametric",
        stocks={"real_cagr": stocks, "vol": 0.0},
        bonds={"real_cagr": bonds, "vol": 0.0},
        cash={"real_cagr": cash, "vol": 0.0},
        dividend_yield=0.0,
    )


NO_INFLATION = InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0)


# --- annual_retirement_expenses: the start_age/end_age gating ---------------

def _gated_streams() -> list[ExpenseStream]:
    return [
        ExpenseStream(name="living", annual=30000, inflates=False),          # always on
        ExpenseStream(name="late", annual=10000, start_age=60, inflates=False),  # 60+
        ExpenseStream(name="early", annual=5000, end_age=45, inflates=False),    # ..45
    ]


def _scenario_with_streams(streams, **kw) -> Scenario:
    kw.setdefault("sim", SimSettings(n_paths=2, start_year=2026))
    return Scenario(
        profile=Profile(birth_year=1986, horizon_age=90, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=200000, cost_basis=200000)],
        income=Income(gross_salary=0),
        expense_streams=streams,
        conversion_rule=ConversionRule(kind="none"),
        inflation=NO_INFLATION,
        **kw,
    )


def test_annual_expenses_honors_stream_windows():
    s = _scenario_with_streams(_gated_streams())
    # age 40: living + early (early.end_age 45 >= 40), late not yet started
    assert m.annual_retirement_expenses(s, 40) == pytest.approx(35000)
    # age 45: living + early (boundary is inclusive: 45 <= end_age 45)
    assert m.annual_retirement_expenses(s, 45) == pytest.approx(35000)
    # age 50: only living (early ended, late not started)
    assert m.annual_retirement_expenses(s, 50) == pytest.approx(30000)
    # age 60: living + late (boundary inclusive: start_age 60 <= 60)
    assert m.annual_retirement_expenses(s, 60) == pytest.approx(40000)


# --- fire_number_simple: 25x expenses at the planned retirement age ---------

def test_fire_number_simple_is_25x_expenses_at_retirement_age():
    # retire at 50: only the always-on stream is active -> 25 * 30,000
    s = _scenario_with_streams(_gated_streams(), retirement_age=50,
                               allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
                               market=_flat_market(0.05))
    assert m.fire_number_simple(s) == pytest.approx(25 * 30000)


def test_fire_number_simple_picks_up_streams_active_at_that_age():
    # retire at 65: the late stream is active too -> 25 * (30k + 10k)
    s = _scenario_with_streams(_gated_streams(), retirement_age=65,
                               allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
                               market=_flat_market(0.05))
    assert m.fire_number_simple(s) == pytest.approx(25 * 40000)


# --- coast_fire: discount the MC FIRE number (not 25x) at the blended real CAGR -

def _coast_scenario(balance: float = 1_000_000, target_age: int = 50,
                    allocation=None, market=None) -> Scenario:
    """Retire-at-target coast setup: start age 40, horizon 64, zero-real / zero-vol
    / zero-tax so the MC FIRE number at the target age is deterministic (~15 years
    of 40k spending ≈ 600k — well under the 25x rule's 1.0M, which proves the
    numerator is the MC value, not 25x expenses)."""
    s = Scenario(
        profile=Profile(birth_year=1986, horizon_age=64, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=balance, cost_basis=balance)],
        income=Income(gross_salary=0),
        retirement_age=45,
        expense_streams=[ExpenseStream(name="living", annual=40000, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        allocation=allocation or Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        market=market or _flat_market(0.04),
        inflation=NO_INFLATION,
        sim=SimSettings(n_paths=4, start_year=2026, coast_target_age=target_age,
                        success_threshold=0.90),
    )
    s.withdrawal_policy.cash_buffer = 0.0
    return s


def test_coast_fire_discounts_the_mc_target_not_25x():
    s = _coast_scenario()
    res = m.coast_fire(s, n_paths=8)
    assert res["years_to_target"] == 10            # target 50 - start 40
    assert res["assumed_real_return"] == pytest.approx(0.04)
    fire = res["fire_number_at_target"]
    assert fire is not None
    # The MC FIRE number at age 50 (~600k), NOT the 25x rule's 25 * 40k = 1.0M.
    assert 450_000 < fire < 750_000
    # ...and it discounts that MC target back to today at the blended real return.
    assert res["coast_number"] == pytest.approx(fire / 1.04 ** 10)
    assert res["progress"] == pytest.approx(1_000_000 / res["coast_number"])


def test_coast_fire_target_is_the_minimum_balance_to_retire_at_that_age():
    # Independently confirm the numerator's meaning: a portfolio of exactly
    # fire_number_at_target, held AT the target age, clears the threshold there;
    # 10% less does not. (Shift the sim to the target age, retire immediately.)
    s = _coast_scenario()
    fire = m.coast_fire(s, n_paths=8)["fire_number_at_target"]
    shifted = s.model_copy(deep=True)
    shifted.sim.start_year = s.profile.birth_year + 50   # person is 50 now
    current = sum(a.balance for a in s.accounts)
    at = fire / current
    assert run(shifted, retirement_age=50, balance_scale=at).success_rate >= 0.90
    assert run(shifted, retirement_age=50, balance_scale=at * 0.90).success_rate < 0.90


def test_coast_fire_blends_return_across_allocation():
    # 60/40 of 5% / 2% real -> blended 3.8% real return in the discount factor.
    s = _coast_scenario(allocation=Allocation(stocks=0.6, bonds=0.4, cash=0.0),
                        market=_flat_market(0.05, bonds=0.02))
    res = m.coast_fire(s, n_paths=8)
    assert res["assumed_real_return"] == pytest.approx(0.038)
    assert res["coast_number"] == pytest.approx(res["fire_number_at_target"] / 1.038 ** 10)


def test_coast_fire_target_today_equals_mc_fire_number_today():
    # Coast target == current age: no discount, so the coast number IS the MC FIRE
    # number for retiring today.
    s = _coast_scenario(target_age=40)  # == start age
    res = m.coast_fire(s, n_paths=8)
    assert res["years_to_target"] == 0
    assert res["coast_number"] == pytest.approx(res["fire_number_at_target"])
    assert res["fire_number_at_target"] == pytest.approx(m.fire_number_mc(s, n_paths=8))


def test_coast_fire_none_without_assets():
    s = _coast_scenario(balance=0.0)
    res = m.coast_fire(s, n_paths=8)
    assert res["coast_number"] is None
    assert res["progress"] is None
    assert res["fire_number_at_target"] is None
    assert res["assumed_real_return"] == pytest.approx(0.04)  # still reported


# --- fire_number_mc: the bisected minimum portfolio to retire now -----------

def _mc_scenario(balance: float) -> Scenario:
    """Retire immediately at 50, spend 40k/yr to a horizon of 64, in a zero-real,
    zero-inflation, zero-tax world so the bisection has a deterministic target."""
    s = Scenario(
        profile=Profile(birth_year=1976, horizon_age=64, state_tax_rate=0.0),
        accounts=[Account(type=AccountType.taxable, balance=balance, cost_basis=balance)],
        income=Income(gross_salary=0),
        retirement_age=50,
        expense_streams=[ExpenseStream(name="living", annual=40000, inflates=False)],
        conversion_rule=ConversionRule(kind="none"),
        allocation=Allocation(stocks=1.0, bonds=0.0, cash=0.0),
        market=_flat_market(0.0),
        inflation=NO_INFLATION,
        sim=SimSettings(n_paths=4, start_year=2026, success_threshold=0.90),
    )
    s.withdrawal_policy.cash_buffer = 0.0
    return s


def test_fire_number_mc_returns_the_minimum_funding_balance():
    s = _mc_scenario(balance=1_000_000)  # comfortably more than needed
    fire = m.fire_number_mc(s, n_paths=8)
    assert fire is not None
    # Zero return, ~15 years of 40k spending -> on the order of 600k. Loose band;
    # the knife-edge below is the precise check.
    assert 450_000 < fire < 750_000

    start_age = s.start_age
    current_total = sum(a.balance for a in s.accounts)
    at = fire / current_total
    # Retiring now with exactly this balance clears the success threshold...
    assert run(s, retirement_age=start_age, balance_scale=at).success_rate >= 0.90
    # ...but a meaningfully smaller balance does not — it really is the minimum.
    assert run(s, retirement_age=start_age, balance_scale=at * 0.90).success_rate < 0.90


def test_fire_number_mc_scales_above_current_balance_when_short():
    # The pre-FI case: today's balance can't fund retiring now, so the search must
    # climb ABOVE 1x current balance to find the funding level.
    s = _mc_scenario(balance=100_000)  # far short of the ~600k needed
    fire = m.fire_number_mc(s, n_paths=8)
    assert fire is not None
    assert fire > 100_000                  # you need more than you hold today
    assert 450_000 < fire < 750_000
    at = fire / 100_000
    assert run(s, retirement_age=s.start_age, balance_scale=at).success_rate >= 0.90


def test_fire_number_mc_scales_below_five_percent_when_overfunded():
    # The far-over-funded case: even 5% of today's balance is plenty, so the search
    # must descend below the 0.05 floor. The FIRE number is still the same ~600k.
    s = _mc_scenario(balance=20_000_000)
    fire = m.fire_number_mc(s, n_paths=8)
    assert fire is not None
    assert fire < 0.05 * 20_000_000        # below 5% of the (huge) current balance
    assert 450_000 < fire < 750_000


def test_fire_number_mc_is_invariant_to_current_balance_scale():
    # The MC FIRE number is a property of spending + horizon + market, not of how
    # much you happen to hold today: doubling current balances must not move it.
    lean = m.fire_number_mc(_mc_scenario(balance=600_000), n_paths=8)
    rich = m.fire_number_mc(_mc_scenario(balance=1_200_000), n_paths=8)
    assert lean is not None and rich is not None
    assert lean == pytest.approx(rich, rel=0.05)


def test_fire_number_mc_none_when_no_assets():
    s = _mc_scenario(balance=0.0)
    assert m.fire_number_mc(s, n_paths=8) is None
