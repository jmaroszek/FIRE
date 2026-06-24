"""Accounts, allocation, and the market / inflation model."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .enums import AccountType


class Account(BaseModel):
    type: AccountType
    balance: float = 0.0
    # Taxable only: aggregate cost basis (defaults to balance = no unrealized gains).
    cost_basis: Optional[float] = None
    # Roth only: portion of balance that is direct contribution basis
    # (withdrawable anytime, tax- and penalty-free).
    roth_contribution_basis: float = 0.0
    # Roth only: pre-existing conversions, calendar year -> amount (for the 5-year rule).
    roth_conversions: dict[int, float] = Field(default_factory=dict)


class Allocation(BaseModel):
    stocks: float = 0.90
    bonds: float = 0.10
    cash: float = 0.0

    @model_validator(mode="after")
    def _sums_to_one(self) -> "Allocation":
        total = self.stocks + self.bonds + self.cash
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"allocation must sum to 1.0, got {total}")
        return self


class AssetParams(BaseModel):
    real_cagr: float
    vol: float


class MarketModel(BaseModel):
    mode: Literal["bootstrap", "parametric"] = "bootstrap"
    stocks: AssetParams = AssetParams(real_cagr=0.050, vol=0.17)
    bonds: AssetParams = AssetParams(real_cagr=0.018, vol=0.07)
    # Cash / HYSA: historically savings has roughly kept pace with inflation,
    # ~0.5% real (so ≈ 3% APY at 2.5% inflation). Earns the cash return and is
    # taxed as ordinary interest; uninvested surplus also pools here.
    cash: AssetParams = AssetParams(real_cagr=0.005, vol=0.01)
    # Stationary bootstrap: expected block length in years.
    bootstrap_mean_block: float = 5.0
    # If true, shift historical real returns so their geometric means match the
    # entered real_cagr values (forward-looking de-meaning of history).
    bootstrap_mean_shift: bool = False
    # Annual qualified dividend yield assumed for the taxable account's stock portion.
    dividend_yield: float = 0.02
    # Weighted fund expense ratio (e.g. 0.0005 = 0.05%), applied as a drag on the
    # invested (stock + bond) blended return each year. The dedicated cash pool is
    # unaffected (you hold cash directly, not in a fund). 0 = free index funds.
    expense_ratio: float = 0.0


class InflationModel(BaseModel):
    """AR(1): pi_t = mean + persistence * (pi_{t-1} - mean) + N(0, sigma)."""

    mean: float = 0.025
    persistence: float = 0.65
    sigma: float = 0.012
    initial: float = 0.025


class AllocationSegment(BaseModel):
    """An age-keyed override of the base `allocation` — a glidepath. From
    `start_age` onward (until the next segment) the portfolio uses this mix.
    Mirrors WaterfallSegment: before the first segment the base allocation
    applies, and an empty schedule means one static allocation for all years.
    Use it to model a rising-equity or de-risking glidepath over the plan."""

    start_age: int
    allocation: Allocation = Field(default_factory=Allocation)
