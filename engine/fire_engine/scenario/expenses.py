"""Expense streams and amortizing liabilities."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ExpenseStream(BaseModel):
    name: str
    annual: float
    start_age: Optional[int] = None  # None = from simulation start
    end_age: Optional[int] = None  # None = until horizon (inclusive bounds)
    inflates: bool = True
    extra_inflation: float = 0.0  # e.g. healthcare +1.5% over CPI
    is_medical: bool = False  # eligible for HSA utilization
    essential: bool = False  # essential streams are exempt from guardrail cuts


class Liability(BaseModel):
    """A loan with a fixed nominal payment: mortgage, car loan, business loan.

    The payment is an essential, non-inflating expense each year until the
    amortization (balance grows by interest, shrinks by the payment) reaches
    zero. The outstanding balance is subtracted from reported net worth but
    plays no role in withdrawals or failure — only the payment does.

    `start_age` schedules a FUTURE loan (e.g. a mortgage taken on at 40): the
    balance and payments don't exist until that age, and once it amortizes to
    zero the payment stream stops, dropping expenses. None = present-day debt.
    The offsetting asset (a home) is not modeled, so a future loan's origination
    shows as a step down in reported net worth — net worth here is financial,
    non-home wealth net of debt.
    """

    name: str
    balance: float  # outstanding principal at start_age (or today if start_age is None)
    interest_rate: float = 0.0  # annual nominal rate
    annual_payment: float = 0.0  # fixed nominal payment per year
    start_age: Optional[int] = None  # None = present-day; else the loan begins at this age
