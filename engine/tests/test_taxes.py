"""Hand-computed 2026 single-filer tax cases."""

import numpy as np
import pytest

from fire_engine import taxes


@pytest.fixture(scope="module")
def tables():
    return taxes.load_tax_tables()


def test_bracket_tax_hand_case(tables):
    # taxable 50,000: 12,400*10% + 37,600*12% = 5,752
    tax = taxes.bracket_tax(np.array([50000.0]), tables.ordinary_thresholds,
                            tables.ordinary_rates, 1.0)
    assert tax[0] == pytest.approx(5752.0)


def test_bracket_tax_top_bracket(tables):
    # taxable 1,000,000 reaches the 37% bracket
    tax = taxes.bracket_tax(np.array([1_000_000.0]), tables.ordinary_thresholds,
                            tables.ordinary_rates, 1.0)
    hand = (12400 * 0.10 + (50400 - 12400) * 0.12 + (105700 - 50400) * 0.22
            + (201775 - 105700) * 0.24 + (256225 - 201775) * 0.32
            + (640600 - 256225) * 0.35 + (1_000_000 - 640600) * 0.37)
    assert tax[0] == pytest.approx(hand)


def test_standard_deduction_applied(tables):
    # gross ordinary 66,100 -> taxable 50,000 -> 5,752
    fed, ord_taxable, _ = taxes.federal_tax(np.array([66100.0]), np.array([0.0]),
                                            tables, 1.0)
    assert ord_taxable[0] == pytest.approx(50000.0)
    assert fed[0] == pytest.approx(5752.0)


def test_ltcg_zero_bracket(tables):
    # no ordinary income, 40k gains: fully inside the 0% bracket (after the
    # deduction shields part, even more so)
    fed, _, _ = taxes.federal_tax(np.array([0.0]), np.array([40000.0]), tables, 1.0)
    assert fed[0] == pytest.approx(0.0)


def test_ltcg_stacking(tables):
    # ordinary TAXABLE 40,000 + 20,000 gains: gains fill 49,450-40,000=9,450
    # at 0%, remaining 10,550 at 15% = 1,582.50
    ltcg = taxes.ltcg_stacked_tax(np.array([40000.0]), np.array([20000.0]),
                                  tables, 1.0)
    assert ltcg[0] == pytest.approx(10550 * 0.15)


def test_deduction_spillover_to_ltcg(tables):
    # ordinary 10,000 (< 16,100 deduction): leftover 6,100 shields gains.
    # gains 60,000 -> taxable 53,900: 49,450 at 0%, 4,450 at 15% = 667.50
    fed, ord_taxable, ltcg_taxable = taxes.federal_tax(
        np.array([10000.0]), np.array([60000.0]), tables, 1.0)
    assert ord_taxable[0] == pytest.approx(0.0)
    assert ltcg_taxable[0] == pytest.approx(53900.0)
    assert fed[0] == pytest.approx(4450 * 0.15)


def test_inflation_scales_brackets(tables):
    # doubling all thresholds at 2x inflation: tax(2*income) = 2*tax(income)
    base = taxes.bracket_tax(np.array([50000.0]), tables.ordinary_thresholds,
                             tables.ordinary_rates, 1.0)
    scaled = taxes.bracket_tax(np.array([100000.0]), tables.ordinary_thresholds,
                               tables.ordinary_rates, 2.0)
    assert scaled[0] == pytest.approx(2 * base[0])


def test_fica(tables):
    tax = taxes.fica_tax(np.array([100000.0, 200000.0]), tables, 1.0)
    assert tax[0] == pytest.approx(100000 * 0.0765)
    assert tax[1] == pytest.approx(184500 * 0.062 + 200000 * 0.0145)


def test_taxable_ss_below_base(tables):
    # provisional = 10,000 other + 0.5*18,000 = 19,000 < 25,000 -> none taxed
    taxed = taxes.taxable_social_security(np.array([10000.0]), np.array([18000.0]), tables)
    assert taxed[0] == pytest.approx(0.0)


def test_taxable_ss_50pct_tier(tables):
    # B=12,000, other=20,000 -> provisional 26,000 in (25k, 34k]
    # taxable = min(0.5*B=6,000, 0.5*(26,000-25,000)=500) = 500
    taxed = taxes.taxable_social_security(np.array([20000.0]), np.array([12000.0]), tables)
    assert taxed[0] == pytest.approx(500.0)


def test_taxable_ss_85pct_tier_partial(tables):
    # B=20,000, other=25,000 -> provisional 35,000 > 34,000
    # taxable = min(0.85*B=17,000, 0.85*(35,000-34,000)=850 + min(0.5*B,4,500)=4,500) = 5,350
    taxed = taxes.taxable_social_security(np.array([25000.0]), np.array([20000.0]), tables)
    assert taxed[0] == pytest.approx(5350.0)


def test_taxable_ss_85pct_cap(tables):
    # high provisional income hits the statutory 85% ceiling on the benefit
    taxed = taxes.taxable_social_security(np.array([80000.0]), np.array([20000.0]), tables)
    assert taxed[0] == pytest.approx(0.85 * 20000.0)


def test_taxable_ss_capital_gains_count_as_provisional(tables):
    # LTCG is part of provisional income even though it's taxed at LTCG rates:
    # passing it via other_income must trigger the same taxation as ordinary income
    taxed = taxes.taxable_social_security(np.array([40000.0]), np.array([20000.0]), tables)
    assert taxed[0] == pytest.approx(0.85 * 20000.0)


def test_taxable_ss_thresholds_not_inflation_indexed(tables):
    # The function takes no inflation factor: the same nominal income later in a
    # high-inflation path is taxed identically, so the real thresholds erode —
    # the modeled "tax torpedo". Vectorized across paths.
    other = np.array([20000.0, 20000.0])
    ss = np.array([12000.0, 12000.0])
    taxed = taxes.taxable_social_security(other, ss, tables)
    assert taxed[0] == pytest.approx(500.0)
    assert taxed[1] == pytest.approx(500.0)


def test_bracket_top_lookup(tables):
    infl = np.array([1.0])
    assert taxes.ordinary_bracket_top("std_deduction", tables, infl)[0] == 0.0
    assert taxes.ordinary_bracket_top("12", tables, infl)[0] == pytest.approx(50400.0)
    assert taxes.ordinary_bracket_top("22", tables, infl)[0] == pytest.approx(105700.0)
