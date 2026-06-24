"""Timeline events and their regime overrides."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .enums import AccountType, EventKind
from .market import Allocation


class RegimeOverrides(BaseModel):
    gross_salary: Optional[float] = None  # today's dollars
    salary_real_growth: Optional[float] = None
    allocation: Optional[Allocation] = None
    employer_match_pct: Optional[float] = None


class Event(BaseModel):
    kind: EventKind
    name: str = ""
    year: Optional[int] = None  # specify year or age (age wins if both)
    age: Optional[int] = None
    # one_time_flow / recurring_flow: positive = outflow/expense, negative = windfall/inflow.
    amount: float = 0.0
    # one_time_flow: pull from this account specifically; None = withdrawal policy.
    # For windfalls, the destination account (default taxable).
    account: Optional[AccountType] = None
    # recurring_flow: repeat the flow every `interval_years` starting at age/year,
    # through `end_age` (inclusive; None = the plan horizon). Each occurrence behaves
    # exactly like a one_time_flow of `amount` from/to `account`. Models lumpy,
    # periodic costs — a new GPU every 3 years, a car every 8 — without listing
    # each one. interval_years <= 0 is treated as 1.
    interval_years: int = 1
    end_age: Optional[int] = None
    # crash: returns applied INSTEAD of the sampled returns that year.
    stock_return: Optional[float] = None
    bond_return: Optional[float] = None
    overrides: Optional[RegimeOverrides] = None
