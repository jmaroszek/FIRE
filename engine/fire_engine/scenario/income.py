"""Primary income and additional income streams."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Income(BaseModel):
    gross_salary: float = 0.0
    # Annual raise. "nominal" (default) is the number on your review letter
    # (e.g. 3%); the engine converts to real growth using expected inflation:
    # real = (1+nominal)/(1+mean_inflation) - 1. "real" uses the value as-is.
    real_growth: float = 0.005
    growth_mode: Literal["nominal", "real"] = "nominal"
    # Employer match as a fraction of gross salary (e.g. 0.04 = 4% of salary),
    # contributed to trad_401k whenever the employee contributes anything to a 401k.
    employer_match_pct: float = 0.0
    # Annual bonus riding the primary salary line (today's $). It compounds at the
    # same raise as the salary, stops at retirement, and counts as the filer's own
    # FICA-taxed wages (Social-Security-covered). The employer match keys off base
    # salary only, so the bonus is excluded from the match base. `bonus_vol` adds
    # per-path lognormal year-to-year variability (0 = a steady, predictable bonus).
    bonus: float = 0.0
    bonus_vol: float = 0.0

    def effective_real_growth(self, mean_inflation: float) -> float:
        if self.growth_mode == "nominal":
            return (1 + self.real_growth) / (1 + mean_inflation) - 1
        return self.real_growth


class IncomeStream(BaseModel):
    """A secondary income source layered on top of the primary salary (`income`):
    a side hustle, rental, consulting, or a spouse's wages. Unlike the primary
    salary it does NOT carry the employer 401k match (the match anchors to
    `income`), but it does count as earned income that raises the IRA/401k
    contribution headroom while it is active.

    Active over [start_age, end_age] (inclusive; defaults: from sim start, to
    horizon), so a stream can run before, during, or after retirement — modeling
    barista-FI income as a post-retirement stream, for instance. `vol` adds
    per-path lognormal income variability (0 = steady); side income is where the
    variance usually lives, while the primary salary stays predictable.
    """

    name: str = "Side Income"
    annual: float = 0.0  # today's dollars
    start_age: Optional[int] = None  # None = from simulation start
    end_age: Optional[int] = None  # None = until horizon (inclusive bounds)
    real_growth: float = 0.0
    growth_mode: Literal["nominal", "real"] = "nominal"
    vol: float = 0.0  # per-path lognormal volatility of this stream's annual income
    # True only for the filer's own FICA/SE-taxed wages (a bonus, consulting,
    # self-employment) — counts toward the Social Security earnings record.
    # Leave False for portfolio income, rent, pensions, or a spouse's wages.
    ss_covered: bool = False

    def effective_real_growth(self, mean_inflation: float) -> float:
        if self.growth_mode == "nominal":
            return (1 + self.real_growth) / (1 + mean_inflation) - 1
        return self.real_growth
