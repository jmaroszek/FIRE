"""Social Security, HSA, ACA, IRMAA, and long-term-care config."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class SocialSecurity(BaseModel):
    # "manual": monthly_at_fra is the user's ssa.gov figure. "estimated": the
    # engine derives monthly_at_fra from the plan's covered-earnings history
    # (see social_security.py), so the post-retirement $0 years are counted —
    # the correction an ssa.gov projection (work-until-FRA) omits.
    benefit_mode: Literal["manual", "estimated"] = "manual"
    monthly_at_fra: float = 0.0  # today's dollars, from ssa.gov statement (manual mode)
    claiming_age: int = 67
    haircut: float = 1.0  # 1.0 / 0.75 / 0.50 / 0.25 / 0.0
    # Estimated mode — your work history before the plan's start age:
    work_start_age: Optional[int] = None  # first year of covered earnings
    prior_avg_earnings: float = 0.0  # today's $, flat fill for work_start_age..start
    # Recorded actuals (age -> today's $ covered earnings), e.g. from snapshots;
    # override the prior-history fill for the ages they cover.
    recorded_earnings: dict[int, float] = Field(default_factory=dict)


SS_CLAIMING_FACTORS = {62: 0.70, 63: 0.75, 64: 0.80, 65: 0.8667, 66: 0.9333,
                       67: 1.00, 68: 1.08, 69: 1.16, 70: 1.24}


class HSARule(BaseModel):
    # Fraction of HSA-eligible expenses paid tax-free from the HSA (rest from
    # cash flow).
    utilization: float = 1.0
    coverage: Literal["self_only", "family"] = "self_only"
    # Keep this much of the HSA (today's dollars) uninvested, earning the cash
    # return, for near-term medical liquidity; the rest is invested.
    cash_buffer: float = 0.0


class ACAConfig(BaseModel):
    """Pre-65 ACA marketplace premium with the post-2021 (IRA-extended) subsidy:
    the expected contribution caps at 8.5% of MAGI with no 400%-FPL cliff. The
    subsidy is keyed to one benchmark (second-lowest-cost Silver) premium you
    supply, against your actual plan's premium. Only applies once retired and
    before Medicare. See docs/ASSUMPTIONS.md #26."""

    enabled: bool = False
    benchmark_annual: float = 0.0  # today's $, the SLCSP benchmark premium
    actual_annual: float = 0.0  # today's $, your chosen plan's premium
    coverage_end_age: int = 65  # Medicare starts; ACA stops
    fpl_base_single: float = 15060.0  # 2025 federal poverty line, single (today's $)


class IRMAABracket(BaseModel):
    magi_threshold: float  # today's $, single filer; surcharge applies ABOVE this
    annual_surcharge: float  # today's $, combined Part B + D, per year


def default_irmaa_brackets() -> list["IRMAABracket"]:
    # 2025 single-filer tiers, combined Part B + D annual surcharge (approximate).
    return [
        IRMAABracket(magi_threshold=106000, annual_surcharge=1050),
        IRMAABracket(magi_threshold=133000, annual_surcharge=2640),
        IRMAABracket(magi_threshold=167000, annual_surcharge=4230),
        IRMAABracket(magi_threshold=200000, annual_surcharge=5810),
        IRMAABracket(magi_threshold=500000, annual_surcharge=6370),
    ]


class IRMAAConfig(BaseModel):
    """Medicare income-related premium surcharge (Part B + D) at 65+. A step
    function on MAGI. Real IRMAA lags two years (it keys off MAGI from two years
    prior); the engine uses current-year MAGI as a documented simplification.
    See docs/ASSUMPTIONS.md #27.

    On by default: it only bites above ~$106k MAGI (so it's $0 for modest paths)
    and folds into the existing per-year fixed point, so enabling it is strictly
    more accurate at negligible cost."""

    enabled: bool = True
    start_age: int = 65
    brackets: list[IRMAABracket] = Field(default_factory=default_irmaa_brackets)


class LTCConfig(BaseModel):
    """Long-term / end-of-life care: a late-life essential medical expense
    (in-home aide, assisted living, or nursing home). Off by default.

    When enabled it adds `annual_cost` (today's $, HSA-eligible, healthcare-
    inflating) as an essential expense from `onset_age` for `duration_years`
    years. Deterministic — a planning provision you size to the care level and
    length you want covered, not a probabilistic shock. US medians (2024):
    in-home aide ~$75k/yr, assisted living ~$70k/yr, nursing home ~$95-120k/yr;
    the typical stay is ~2-3 years (longer for women)."""

    enabled: bool = False
    onset_age: int = 84
    annual_cost: float = 0.0  # today's $
    duration_years: int = 3
    extra_inflation: float = 0.015  # healthcare CPI+
