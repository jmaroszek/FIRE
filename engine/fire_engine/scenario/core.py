"""Profile, sim settings, the top-level Scenario, and the example factory."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .enums import SCHEMA_VERSION, AccountType
from .market import Account, Allocation, AllocationSegment, InflationModel, MarketModel
from .income import Income, IncomeStream
from .expenses import ExpenseStream, Liability
from .spending import (
    ConversionRule, GuardrailRule, SpendingStrategy, WaterfallSegment, WaterfallStep,
    WithdrawalPolicy, default_waterfall,
)
from .health import ACAConfig, HSARule, IRMAAConfig, LTCConfig, SocialSecurity
from .events import Event


class Profile(BaseModel):
    birth_year: int = 2000
    horizon_age: int = 90
    state_tax_rate: float = 0.05
    filing_status: Literal["single"] = "single"


class SimSettings(BaseModel):
    n_paths: int = 2000
    seed: int = 42
    start_year: int = 2026
    success_threshold: float = 0.90
    coast_target_age: int = 60
    # Die-with-zero bequest floor (today's dollars). A path counts as a success
    # only if it funds all spending AND ends with at least this much real net
    # worth — a personal safety cushion or an intended inheritance/donation.
    # 0 (default) = pure die-with-zero: any non-negative ending is a success.
    legacy_target: float = 0.0


class Scenario(BaseModel):
    schema_version: int = SCHEMA_VERSION
    name: str = "Default"
    profile: Profile = Profile()
    accounts: list[Account] = Field(default_factory=list)
    allocation: Allocation = Allocation()
    # Optional age-keyed glidepath overriding `allocation` from each start_age.
    # Empty (default) = one static allocation for all years (back-compatible).
    allocation_schedule: list[AllocationSegment] = Field(default_factory=list)
    market: MarketModel = MarketModel()
    inflation: InflationModel = InflationModel()
    income: Income = Income()
    # Additional income sources beyond the primary salary (side hustles, rental,
    # spouse). Empty = single-salary behavior (back-compatible).
    income_streams: list[IncomeStream] = Field(default_factory=list)
    retirement_age: int = 65
    expense_streams: list[ExpenseStream] = Field(default_factory=list)
    # HSA-eligible out-of-pocket medical spending, kept in its own section rather
    # than mixed into the general expense table with a per-row checkbox. Always
    # essential medical; drives HSA utilization. The per-stream is_medical flag on
    # expense_streams is deprecated but still honored as a fallback for old data.
    medical_streams: list[ExpenseStream] = Field(default_factory=list)
    liabilities: list[Liability] = Field(default_factory=list)
    waterfall: list[WaterfallStep] = Field(default_factory=default_waterfall)
    # Optional age-keyed overrides of `waterfall` (e.g. divert from 401k to taxable
    # while saving for a house). Empty = the base waterfall applies for all years.
    waterfall_schedule: list[WaterfallSegment] = Field(default_factory=list)
    withdrawal_policy: WithdrawalPolicy = WithdrawalPolicy()
    conversion_rule: ConversionRule = ConversionRule()
    social_security: SocialSecurity = SocialSecurity()
    hsa: HSARule = HSARule()
    guardrails: GuardrailRule = GuardrailRule()
    spending_strategy: SpendingStrategy = SpendingStrategy()
    aca: ACAConfig = ACAConfig()
    irmaa: IRMAAConfig = IRMAAConfig()
    # Long-term / end-of-life care provision (off by default). When enabled it
    # adds a late-life essential, HSA-eligible medical expense over its window.
    ltc: LTCConfig = LTCConfig()
    events: list[Event] = Field(default_factory=list)
    sim: SimSettings = SimSettings()

    @property
    def start_age(self) -> int:
        return self.sim.start_year - self.profile.birth_year

    @property
    def n_years(self) -> int:
        return self.profile.horizon_age - self.start_age + 1

    def event_year_index(self, event: Event) -> int:
        """Map an event to a 0-based simulation year index."""
        if event.age is not None:
            year = self.profile.birth_year + event.age
        elif event.year is not None:
            year = event.year
        else:
            raise ValueError(f"event {event.name!r} needs a year or an age")
        return year - self.sim.start_year


def example_scenario() -> Scenario:
    """A representative default scenario (used by GET /defaults and tests)."""
    return Scenario(
        name="Example",
        profile=Profile(birth_year=2000, horizon_age=90, state_tax_rate=0.05),
        accounts=[
            Account(type=AccountType.taxable, balance=30000, cost_basis=25000),
            Account(type=AccountType.trad_401k, balance=60000),
            Account(type=AccountType.roth_ira, balance=35000, roth_contribution_basis=28000),
            Account(type=AccountType.hsa, balance=12000),
            Account(type=AccountType.cash, balance=15000),
        ],
        income=Income(gross_salary=110000, real_growth=0.03, growth_mode="nominal",
                      employer_match_pct=0.04),
        retirement_age=45,
        expense_streams=[
            ExpenseStream(name="Living expenses", annual=45000),
            ExpenseStream(name="Healthcare (pre-65)", annual=6000, start_age=45,
                          end_age=64, extra_inflation=0.015, is_medical=True,
                          essential=True),
            ExpenseStream(name="Medical out-of-pocket", annual=1500, is_medical=True,
                          essential=True),
        ],
        conversion_rule=ConversionRule(kind="fill_bracket", bracket_top="12"),
        social_security=SocialSecurity(monthly_at_fra=2800, claiming_age=67, haircut=0.75),
    )
