"""Housing: derived mortgage + home-asset overlay, kept out of the FIRE math."""

from __future__ import annotations

import numpy as np
import pytest

from fire_engine import example_scenario, run
from fire_engine.engine import _annual_payment, _expand_housing_streams, _housing_schedule
from fire_engine.metrics import summarize
from fire_engine.scenario import HousingConfig, Scenario


def _afford() -> Scenario:
    """A profile that can comfortably carry a house (so success math is exercised
    rather than dominated by an unaffordable purchase)."""
    s = example_scenario()
    return s.model_copy(update={"retirement_age": 60})


def _with_house(s: Scenario, **kw) -> Scenario:
    base = dict(enabled=True, purchase_age=30, home_price=350000, down_payment_pct=0.20,
                closing_costs_pct=0.03, mortgage_rate=0.065, loan_term_years=30,
                appreciation_real=0.0)
    base.update(kw)
    return s.model_copy(update={"housing": HousingConfig(**base)})


# --- regression: disabled housing must not change anything ----------------

def test_housing_off_is_a_no_op():
    s = example_scenario()
    r = run(s, deterministic=True)
    assert r.home_value is None and r.home_mortgage_balance is None
    summary = summarize(r)
    assert summary["home_value_real"] == []
    assert summary["net_worth_incl_home"] == {}


def test_disabled_housing_matches_baseline_bitwise():
    """A default (disabled) HousingConfig leaves every result identical."""
    s = example_scenario()
    base = run(s, deterministic=True)
    # an explicitly-disabled config with non-trivial fields set must still be inert
    s2 = s.model_copy(update={"housing": HousingConfig(enabled=False, home_price=999999)})
    same = run(s2, deterministic=True)
    assert np.array_equal(base.net_worth, same.net_worth)
    assert base.success_rate == same.success_rate


# --- amortization ----------------------------------------------------------

def test_annual_payment_matches_closed_form():
    # $280k, 6.5%, 30yr — standard annual amortization payment
    pay = _annual_payment(280000, 0.065, 30)
    assert pay == pytest.approx(280000 * 0.065 / (1 - 1.065 ** -30), rel=1e-9)


def test_zero_rate_loan_is_straight_line():
    assert _annual_payment(300000, 0.0, 30) == pytest.approx(10000)


def test_mortgage_amortizes_to_zero_at_term():
    s = _with_house(_afford(), purchase_age=30, loan_term_years=30)
    sched = _housing_schedule(s, s.n_years)
    pt = 30 - s.start_age
    own0 = pt + 1
    # balance gone by own0 + term (allow boundary clamp at horizon)
    payoff_idx = min(own0 + 30, s.n_years)
    assert sched.mortgage_balance[payoff_idx] == pytest.approx(0.0, abs=1.0)


# --- home asset & equity ---------------------------------------------------

def test_price_loan_and_equity_at_purchase():
    s = _with_house(_afford(), down_payment_pct=0.20, appreciation_real=0.0)
    sched = _housing_schedule(s, s.n_years)
    pt = 30 - s.start_age
    own0 = pt + 1
    g = s.inflation.mean  # appreciation_real=0 -> nominal appreciation = mean
    price = 350000 * (1 + g) ** pt
    assert sched.home_value[own0] == pytest.approx(price, rel=1e-9)
    assert sched.mortgage_balance[own0] == pytest.approx(0.80 * price, rel=1e-9)
    equity = sched.home_value[own0] - sched.mortgage_balance[own0]
    assert equity == pytest.approx(0.20 * price, rel=1e-9)


def test_home_absent_before_purchase():
    s = _with_house(_afford(), purchase_age=35)
    sched = _housing_schedule(s, s.n_years)
    own0 = (35 - s.start_age) + 1
    assert np.allclose(sched.home_value[:own0], 0.0)
    assert np.allclose(sched.mortgage_balance[:own0], 0.0)


def test_appreciation_compounds_in_real_terms():
    s = _with_house(_afford(), appreciation_real=0.02)
    sched = _housing_schedule(s, s.n_years)
    pt = 30 - s.start_age
    own0 = pt + 1
    g = (1 + s.inflation.mean) * 1.02 - 1
    # ten years after purchase the home grew by (1+g)^10 nominally
    assert sched.home_value[own0 + 10] == pytest.approx(
        sched.home_value[own0] * (1 + g) ** 10, rel=1e-9)


# --- the home stays out of the spendable / success math --------------------

def test_home_equity_excluded_from_success_pool():
    """Enabling housing must not let the home prop up FIRE success: the financial
    net-worth fan and success rate come only from spendable accounts."""
    s = _afford()
    off = run(s, deterministic=True)
    # buy a fully-paid home (100% down) of modest size: no mortgage, no leverage.
    s_on = _with_house(s, down_payment_pct=1.0, home_price=50000, closing_costs_pct=0.0)
    on = run(s_on, deterministic=True)
    # the home is an asset, yet success can only drop or hold (cash left the pool) —
    # it can never rise because we "own a house."
    assert on.success_rate <= off.success_rate + 1e-12


def test_net_worth_incl_home_adds_the_asset():
    s = _with_house(_afford())
    r = run(s, deterministic=True)
    fan = summarize(r)["net_worth_incl_home"]
    assert set(fan) == {"p5", "p25", "p50", "p75", "p95"}
    # incl-home median >= financial median at every boundary (home value >= 0)
    base = np.median(r.net_worth / r.cum_inflation, axis=0)
    incl = np.array(fan["p50"])
    assert np.all(incl >= base - 1.0)


def test_no_net_worth_blip_at_purchase():
    """Net-worth-including-home rises smoothly through the purchase — no spurious
    step from the down payment / mortgage appearing without the offsetting asset."""
    s = _with_house(_afford(), appreciation_real=0.0)
    r = run(s, deterministic=True)
    pt = 30 - s.start_age
    own0 = pt + 1
    nwih = np.median((r.net_worth + r.home_value[None, :]) / r.cum_inflation, axis=0)
    deltas = np.diff(nwih)
    # the year-over-year change at purchase is within the band of its neighbours —
    # accumulation slows (cash -> flat home + mortgage) but does not jump or crater.
    around = deltas[own0 - 3: own0 + 2]
    assert deltas[own0 - 1] < max(around) + 1.0
    assert deltas[own0 - 1] > 0  # still rising (no step down in the incl-home line)


# --- sale / downsize -------------------------------------------------------

def test_sale_zeros_home_and_mortgage_after():
    s = _with_house(_afford(), sale_age=55, appreciation_real=0.01)
    sched = _housing_schedule(s, s.n_years)
    st = 55 - s.start_age
    assert sched.sale_t == st
    assert sched.home_value[st] > 0 and sched.home_value[st + 1] == 0
    assert sched.mortgage_balance[st + 1] == 0


def test_sale_proceeds_net_of_payoff_and_costs():
    s = _with_house(_afford(), sale_age=55, selling_costs_pct=0.06, appreciation_real=0.01)
    sched = _housing_schedule(s, s.n_years)
    st = sched.sale_t
    value, mortgage = sched.home_value[st], sched.mortgage_balance[st]
    # small gain here is under the §121 exclusion -> no cap-gains tax
    expected = value - mortgage - 0.06 * value
    assert sched.sale_proceeds == pytest.approx(expected, rel=1e-9)


def test_sale_deposits_proceeds_into_liquid_account():
    s = _with_house(_afford(), sale_age=55, appreciation_real=0.01)
    r = run(s, deterministic=True)
    st = 55 - s.start_age
    taxable = np.median(r.pools["taxable"], axis=0)
    assert taxable[st + 1] > taxable[st] + 100000  # proceeds landed


def test_big_gain_above_exclusion_is_taxed():
    """A large nominal gain above the (grown) §121 exclusion incurs cap-gains tax,
    reducing net proceeds below the no-tax figure."""
    s = _with_house(_afford(), sale_age=60, appreciation_real=0.04,
                    cap_gains_exclusion=0.0, cap_gains_rate=0.15)
    sched = _housing_schedule(s, s.n_years)
    st = sched.sale_t
    value, mortgage = sched.home_value[st], sched.mortgage_balance[st]
    costs = 0.06 * value
    no_tax = value - mortgage - costs
    assert sched.sale_proceeds < no_tax  # tax was applied


# --- PMI -------------------------------------------------------------------

def _stream(scenario, name):
    return next((s for s in scenario.expense_streams if s.name == name), None)


def test_no_pmi_at_twenty_percent_down():
    s = _with_house(_afford(), down_payment_pct=0.20)
    assert _stream(_expand_housing_streams(s), "PMI") is None


def test_pmi_added_below_twenty_percent_down():
    s = _with_house(_afford(), down_payment_pct=0.10, pmi_rate=0.0075)
    pmi = _stream(_expand_housing_streams(s), "PMI")
    assert pmi is not None
    assert pmi.inflates is False and pmi.essential  # flat nominal, essential
    # a 10%-down loan reaches 78% LTV partway through the term, not at the end
    assert pmi.start_age < pmi.end_age < pmi.start_age + s.housing.loan_term_years


def test_pmi_carrying_cost_streams_present():
    s = _expand_housing_streams(_with_house(_afford()))
    for name in ("Property Tax", "Home Insurance", "Home Maintenance"):
        assert _stream(s, name) is not None


# --- down payment leaves the portfolio -------------------------------------

# --- itemized deductions ---------------------------------------------------

def test_federal_tax_takes_the_larger_deduction():
    import fire_engine.taxes as tx
    tables = tx.load_tax_tables()
    inc = np.array([120000.0])
    std_tax, _, _ = tx.federal_tax(inc, np.array([0.0]), tables, 1.0, 0.0)
    # an itemized deduction well above the standard one lowers the tax
    item_tax, _, _ = tx.federal_tax(inc, np.array([0.0]), tables, 1.0, np.array([35000.0]))
    assert item_tax[0] < std_tax[0]
    # a tiny itemized deduction (below standard) leaves the tax unchanged
    small_tax, _, _ = tx.federal_tax(inc, np.array([0.0]), tables, 1.0, np.array([100.0]))
    assert small_tax[0] == pytest.approx(std_tax[0])


def test_itemizing_lowers_a_mortgage_year_tax():
    s = _afford().model_copy()
    on = run(_with_house(s, purchase_age=28, home_price=400000, mortgage_rate=0.07,
                         itemize_deductions=True), deterministic=True)
    off = run(_with_house(s, purchase_age=28, home_price=400000, mortgage_rate=0.07,
                          itemize_deductions=False), deterministic=True)
    yr = 32 - s.start_age  # an accumulation year deep inside the mortgage
    assert on.taxes_paid[:, yr].mean() < off.taxes_paid[:, yr].mean()


def test_down_payment_reduces_financial_net_worth():
    s = _afford()
    off = run(s, deterministic=True)
    on = run(_with_house(s), deterministic=True)
    pt = 30 - s.start_age
    own0 = pt + 1
    # at purchase the financial (home-excluded) net worth drops vs the no-house path
    nw_off = np.median(off.net_worth / off.cum_inflation, axis=0)
    nw_on = np.median(on.net_worth / on.cum_inflation, axis=0)
    assert nw_on[own0] < nw_off[own0]


def test_down_payment_via_withdrawal_policy():
    """down_payment_account=None routes the up-front cash through the withdrawal
    policy (a general outflow) rather than forcing one account — it still leaves
    the portfolio, so financial net worth drops at purchase."""
    s = _afford()
    off = run(s, deterministic=True)
    on = run(_with_house(s, down_payment_account=None), deterministic=True)
    own0 = (30 - s.start_age) + 1
    nw_off = np.median(off.net_worth / off.cum_inflation, axis=0)
    nw_on = np.median(on.net_worth / on.cum_inflation, axis=0)
    assert nw_on[own0] < nw_off[own0]
