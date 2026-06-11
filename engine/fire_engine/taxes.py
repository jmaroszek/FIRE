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
    ss_taxable_fraction: float


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


def fica_tax(wages: np.ndarray, tables: TaxTables, infl: np.ndarray | float) -> np.ndarray:
    wages = np.asarray(wages, dtype=float)
    infl = np.asarray(infl, dtype=float)
    ss = tables.ss_rate * np.minimum(wages, tables.ss_wage_base * infl)
    return ss + tables.medicare_rate * wages


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
