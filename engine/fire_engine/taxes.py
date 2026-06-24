"""Federal and state tax math, vectorized across Monte Carlo paths.

Modeling boundary (see docs/ASSUMPTIONS.md): federal ordinary brackets + standard
deduction + LTCG stacking for a single filer, FICA on wages, a flat state rate,
and the 10% early-withdrawal penalty. No AMT, NIIT, itemizing, or credits.
All bracket thresholds are scaled by each path's cumulative inflation factor.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).parent / "data"


@dataclass(frozen=True)
class TaxTables:
    base_year: int
    standard_deduction: float
    ordinary_thresholds: np.ndarray  # upper bound of each bracket, inf-terminated
    ordinary_rates: np.ndarray
    ltcg_thresholds: np.ndarray
    ltcg_rates: np.ndarray
    ss_rate: float
    ss_wage_base: float
    medicare_rate: float
    early_penalty: float
    ss_taxable_fraction: float  # statutory maximum (0.85) taxable share of benefits
    ss_base_lower: float  # provisional-income threshold where 50% taxation begins
    ss_base_upper: float  # provisional-income threshold where 85% taxation begins


def load_tax_tables() -> TaxTables:
    raw = json.loads((DATA_DIR / "tax_data.json").read_text())
    single = raw["single"]

    def parse(brackets):
        thresholds = np.array(
            [np.inf if b["up_to"] is None else float(b["up_to"]) for b in brackets]
        )
        rates = np.array([b["rate"] for b in brackets])
        return thresholds, rates

    ord_thr, ord_rates = parse(single["ordinary_brackets"])
    ltcg_thr, ltcg_rates = parse(single["ltcg_brackets"])
    return TaxTables(
        base_year=raw["base_year"],
        standard_deduction=single["standard_deduction"],
        ordinary_thresholds=ord_thr,
        ordinary_rates=ord_rates,
        ltcg_thresholds=ltcg_thr,
        ltcg_rates=ltcg_rates,
        ss_rate=raw["fica"]["social_security_rate"],
        ss_wage_base=raw["fica"]["social_security_wage_base"],
        medicare_rate=raw["fica"]["medicare_rate"],
        early_penalty=raw["early_withdrawal_penalty"],
        ss_taxable_fraction=raw["ss_taxable_fraction"],
        ss_base_lower=raw["ss_provisional_base_lower"],
        ss_base_upper=raw["ss_provisional_base_upper"],
    )


def bracket_tax(income: np.ndarray, thresholds: np.ndarray, rates: np.ndarray,
                infl: np.ndarray | float) -> np.ndarray:
    """Piecewise tax on `income` with thresholds scaled by `infl`.

    income: (P,) taxable income (already net of deductions, >= 0)
    infl:   (P,) or scalar cumulative inflation factor for the year
    """
    income = np.atleast_1d(np.asarray(income, dtype=float))
    infl = np.atleast_1d(np.asarray(infl, dtype=float))
    # (P, B) scaled bracket bounds (infinite top bracket stays infinite)
    inf_mask = np.isinf(thresholds[None, :])
    upper = np.where(inf_mask, np.inf, thresholds[None, :] * infl[:, None])
    lower = np.concatenate([np.zeros_like(upper[:, :1]), upper[:, :-1]], axis=1)
    in_bracket = np.clip(income[:, None] - lower, 0.0, upper - lower)
    return (in_bracket * rates[None, :]).sum(axis=1)


def ltcg_stacked_tax(ordinary_taxable: np.ndarray, ltcg_taxable: np.ndarray,
                     tables: TaxTables, infl: np.ndarray | float) -> np.ndarray:
    """Tax on long-term gains stacked on top of ordinary taxable income.

    Each LTCG bracket taxes the slice of gains falling between
    max(threshold_lower, ordinary) and threshold_upper.
    """
    ordinary_taxable = np.atleast_1d(np.asarray(ordinary_taxable, dtype=float))
    ltcg_taxable = np.atleast_1d(np.asarray(ltcg_taxable, dtype=float))
    infl = np.atleast_1d(np.asarray(infl, dtype=float))
    inf_mask = np.isinf(tables.ltcg_thresholds[None, :])
    upper = np.where(inf_mask, np.inf, tables.ltcg_thresholds[None, :] * infl[:, None])
    lower = np.concatenate([np.zeros_like(upper[:, :1]), upper[:, :-1]], axis=1)
    top = ordinary_taxable[:, None] + ltcg_taxable[:, None]
    slice_lo = np.maximum(lower, ordinary_taxable[:, None])
    slice_hi = np.minimum(upper, top)
    taxed = np.clip(slice_hi - slice_lo, 0.0, None)
    return (taxed * tables.ltcg_rates[None, :]).sum(axis=1)


def federal_tax(ordinary_income: np.ndarray, ltcg_income: np.ndarray,
                tables: TaxTables, infl: np.ndarray | float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Federal tax given gross ordinary income and gross LTCG income.

    The standard deduction applies to ordinary income first; any remainder
    shields LTCG. Returns (total_federal, ordinary_taxable, ltcg_taxable).
    """
    ordinary_income = np.maximum(np.asarray(ordinary_income, dtype=float), 0.0)
    ltcg_income = np.maximum(np.asarray(ltcg_income, dtype=float), 0.0)
    infl_arr = np.asarray(infl, dtype=float)
    std = tables.standard_deduction * infl_arr
    ordinary_taxable = np.maximum(ordinary_income - std, 0.0)
    leftover_deduction = np.maximum(std - ordinary_income, 0.0)
    ltcg_taxable = np.maximum(ltcg_income - leftover_deduction, 0.0)
    tax = bracket_tax(ordinary_taxable, tables.ordinary_thresholds, tables.ordinary_rates, infl)
    tax = tax + ltcg_stacked_tax(ordinary_taxable, ltcg_taxable, tables, infl)
    return tax, ordinary_taxable, ltcg_taxable


def taxable_social_security(
    other_income: np.ndarray, ss_benefits: np.ndarray, tables: TaxTables
) -> np.ndarray:
    """Federally taxable portion of Social Security benefits (single filer).

    Implements the IRS provisional-income test (Pub. 915 worksheet):

        provisional = other_income + 0.5 * benefits

    where ``other_income`` is all non-SS income (ordinary + capital gains, gross
    of the standard deduction). The taxable share steps 0% -> 50% -> 85% across
    two thresholds (``lower``, ``upper``):

        provisional <= lower:          0
        lower < provisional <= upper:  min(0.5*B, 0.5*(provisional - lower))
        provisional > upper:           min(0.85*B,
                                           0.85*(provisional - upper)
                                           + min(0.5*B, 0.5*(upper - lower)))

    The thresholds ($25,000 / $34,000) are fixed in statute and NOT indexed for
    inflation, so they are intentionally compared against NOMINAL income with no
    `infl` scaling. Over a long, inflating retirement this realistically drags a
    rising share of the benefit into tax — the Social Security "tax torpedo" —
    and is the reason a flat 85% assumption misleads bracket-management planning.
    """
    other = np.maximum(np.asarray(other_income, dtype=float), 0.0)
    ss = np.maximum(np.asarray(ss_benefits, dtype=float), 0.0)
    lower, upper, cap = tables.ss_base_lower, tables.ss_base_upper, tables.ss_taxable_fraction
    provisional = other + 0.5 * ss
    mid = np.minimum(0.5 * ss, 0.5 * np.maximum(provisional - lower, 0.0))
    high = np.minimum(
        cap * ss,
        cap * np.maximum(provisional - upper, 0.0) + np.minimum(0.5 * ss, 0.5 * (upper - lower)),
    )
    return np.where(provisional <= lower, 0.0, np.where(provisional <= upper, mid, high))


def fica_tax(wages: np.ndarray, tables: TaxTables, infl: np.ndarray | float) -> np.ndarray:
    wages = np.asarray(wages, dtype=float)
    infl = np.asarray(infl, dtype=float)
    ss = tables.ss_rate * np.minimum(wages, tables.ss_wage_base * infl)
    return ss + tables.medicare_rate * wages


@dataclass(frozen=True)
class IncomeTax:
    """One year's income tax, decomposed. All fields are (P,) nominal arrays."""
    ordinary_excl_ss: np.ndarray   # ordinary income before the taxable-SS add-back
    ltcg: np.ndarray               # long-term gains + qualified dividends
    taxable_ss: np.ndarray         # taxable portion of the SS benefit
    ordinary: np.ndarray           # ordinary_excl_ss + taxable_ss
    ordinary_taxable: np.ndarray   # ordinary after the standard deduction
    ltcg_taxable: np.ndarray       # LTCG stacked above ordinary
    federal: np.ndarray
    state: np.ndarray
    fica: np.ndarray
    penalty: np.ndarray
    total: np.ndarray              # federal + state + fica + penalty


def income_tax(
    *,
    wages: np.ndarray,
    pretax: np.ndarray,
    rmd: np.ndarray,
    conversions: np.ndarray,
    withdrawal_ordinary: np.ndarray,
    cash_interest: np.ndarray,
    dividends: np.ndarray,
    withdrawal_ltcg: np.ndarray,
    withdrawal_penalty_base: np.ndarray,
    ss_benefits: np.ndarray,
    tables: TaxTables,
    tables_eff: TaxTables,
    infl: np.ndarray | float,
    state_rate: float,
) -> IncomeTax:
    """Total income tax for one year, co-resolving the Social Security
    provisional-income test (the "tax torpedo") and LTCG stacking.

    Ordinary income is wages net of pretax contributions, plus RMDs, Roth
    conversions, traditional/HSA withdrawals, and cash interest; the taxable
    portion of Social Security (decided by the provisional-income test on
    everything else) is then stacked on top — a flat fraction would hide that
    torpedo from bracket-management decisions. `tables` carries the statutory
    SS/FICA/penalty params; `tables_eff` carries the (possibly sunset-adjusted)
    brackets used for the income tax itself. Pure — array inputs are (P,) nominal.
    """
    ordinary_excl_ss = (
        np.maximum(wages - pretax, 0.0)
        + rmd + conversions + withdrawal_ordinary + cash_interest
    )
    ltcg = dividends + withdrawal_ltcg
    taxable_ss = taxable_social_security(ordinary_excl_ss + ltcg, ss_benefits, tables)
    ordinary = ordinary_excl_ss + taxable_ss
    fed, ord_taxable, ltcg_taxable = federal_tax(ordinary, ltcg, tables_eff, infl)
    state = state_rate * (ord_taxable + ltcg_taxable)
    fica = fica_tax(wages, tables, infl)
    penalty = tables.early_penalty * withdrawal_penalty_base
    total = fed + state + fica + penalty
    return IncomeTax(
        ordinary_excl_ss=ordinary_excl_ss, ltcg=ltcg, taxable_ss=taxable_ss,
        ordinary=ordinary, ordinary_taxable=ord_taxable, ltcg_taxable=ltcg_taxable,
        federal=fed, state=state, fica=fica, penalty=penalty, total=total,
    )


def ordinary_bracket_top(name: str, tables: TaxTables, infl: np.ndarray | float) -> np.ndarray:
    """Nominal taxable-income level at the top of a named bracket (for
    fill-to-bracket Roth conversions). 'std_deduction' returns 0 taxable income
    (i.e. convert up to the deduction only)."""
    infl = np.asarray(infl, dtype=float)
    if name == "std_deduction":
        return np.zeros_like(infl)
    rate = {"10": 0.10, "12": 0.12, "22": 0.22}[name]
    idx = int(np.argmax(np.isclose(tables.ordinary_rates, rate)))
    return tables.ordinary_thresholds[idx] * infl
