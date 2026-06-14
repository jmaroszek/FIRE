"""Scenario data model.

A Scenario is the complete, serializable input to one simulation run: profile,
accounts, market model, cash-flow rules, events, and sim settings. All dollar
inputs are expressed in TODAY'S (start-year) dollars; the engine converts to
nominal using each path's simulated inflation. See docs/ASSUMPTIONS.md.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

SCHEMA_VERSION = 1


class AccountType(str, Enum):
    taxable = "taxable"
    trad_401k = "trad_401k"
    trad_ira = "trad_ira"
    roth_ira = "roth_ira"
    roth_401k = "roth_401k"
    hsa = "hsa"
    cash = "cash"


TRAD_TYPES = (AccountType.trad_401k, AccountType.trad_ira)
ROTH_TYPES = (AccountType.roth_ira, AccountType.roth_401k)


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
    cash: AssetParams = AssetParams(real_cagr=0.000, vol=0.01)
    # Stationary bootstrap: expected block length in years.
    bootstrap_mean_block: float = 5.0
    # If true, shift historical real returns so their geometric means match the
    # entered real_cagr values (forward-looking de-meaning of history).
    bootstrap_mean_shift: bool = False
    # Annual qualified dividend yield assumed for the taxable account's stock portion.
    dividend_yield: float = 0.02


class InflationModel(BaseModel):
    """AR(1): pi_t = mean + persistence * (pi_{t-1} - mean) + N(0, sigma)."""

    mean: float = 0.025
    persistence: float = 0.65
    sigma: float = 0.012
    initial: float = 0.025


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

    def effective_real_growth(self, mean_inflation: float) -> float:
        if self.growth_mode == "nominal":
            return (1 + self.real_growth) / (1 + mean_inflation) - 1
        return self.real_growth


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
    """

    name: str
    balance: float  # outstanding principal today
    interest_rate: float = 0.0  # annual nominal rate
    annual_payment: float = 0.0  # fixed nominal payment per year


class GuardrailRule(BaseModel):
    """Guyton-Klinger-style withdrawal-rate guardrails, applied in retirement.

    The initial withdrawal rate w0 is recorded per path in the retirement year.
    Each year, if planned spending / portfolio drifts outside w0 * (1 +/- band),
    discretionary (non-essential) spending is cut or restored by a step,
    bounded by [floor_mult, cap_mult] of the planned amount.
    """

    enabled: bool = False
    band: float = 0.20  # guardrails at w0 * (1 +/- band)
    cut: float = 0.10  # cut discretionary spending 10% when above the upper rail
    boost: float = 0.10  # restore 10% when below the lower rail
    floor_mult: float = 0.70  # never cut below 70% of planned discretionary
    cap_mult: float = 1.0  # never spend above plan (no lifestyle inflation)


class TaxRegimeShock(BaseModel):
    """A documented 'what if today's tax law doesn't last' stress. From
    `sunset_age` onward, ordinary bracket rates are scaled by `bracket_rate_mult`
    and the standard deduction by `std_deduction_mult` — modeling a TCJA-style
    reversion that the whole low-bracket Roth-ladder thesis is implicitly betting
    against. NOT part of the saved Scenario; passed to run() by the stress endpoint.
    """
    sunset_age: int
    bracket_rate_mult: float = 1.15   # ordinary marginal rates ×1.15 (≈ pre-TCJA)
    std_deduction_mult: float = 0.5   # standard deduction roughly halves on reversion


class SpendingStrategy(BaseModel):
    """How much to spend each retirement year — distinct from the Withdrawal
    Policy (which only chooses *which account* to tap).

    - `constant_dollar` (default): fund the plan's expense streams, optionally
      flexed by the Guyton-Klinger guardrails. Preserves the original behavior.
    - `constant_pct`: discretionary spending = `rate` × current portfolio, so it
      self-corrects with the market and never depletes to zero (at the cost of
      income variability).
    - `vpw`: like constant_pct but the rate rises with age via an annuity payout
      factor (assumes `vpw_real_return`), deliberately drawing the balance down.
    - `floor_ceiling`: constant_pct bounded to [floor_mult, ceiling_mult] × the
      plan's discretionary amount, trading some self-correction for a stable floor.

    In every portfolio-% mode, essentials (medical + loan payments) are funded
    first; a path still fails if the portfolio can't cover them.
    """
    kind: Literal["constant_dollar", "constant_pct", "vpw", "floor_ceiling"] = "constant_dollar"
    rate: float = 0.04             # constant_pct / floor_ceiling: share of current portfolio
    vpw_real_return: float = 0.03  # vpw: assumed real return in the annuity payout factor
    floor_mult: float = 0.75       # floor_ceiling: min fraction of plan discretionary
    ceiling_mult: float = 1.25     # floor_ceiling: max fraction of plan discretionary


class WaterfallStep(BaseModel):
    account: AccountType
    kind: Literal["to_match", "max", "fixed"] = "max"
    amount: Optional[float] = None  # today's dollars, for kind="fixed"


def default_waterfall() -> list[WaterfallStep]:
    return [
        WaterfallStep(account=AccountType.trad_401k, kind="to_match"),
        WaterfallStep(account=AccountType.hsa, kind="max"),
        WaterfallStep(account=AccountType.roth_ira, kind="max"),
        WaterfallStep(account=AccountType.trad_401k, kind="max"),
        WaterfallStep(account=AccountType.taxable, kind="max"),  # spillover, unlimited
    ]


class WithdrawalSource(str, Enum):
    cash = "cash"
    taxable = "taxable"
    roth_basis = "roth_basis"  # direct contributions
    roth_matured_conversions = "roth_matured_conversions"  # 5-year rule satisfied
    trad = "trad"  # penalty-free at 59.5+; earlier only if allow_early_trad
    hsa = "hsa"  # non-medical, age 65+ (ordinary income)
    roth_earnings = "roth_earnings"  # qualified at 59.5+ only


class WithdrawalPolicy(BaseModel):
    # Before 59.5: traditional and Roth earnings are locked (penalty), so the
    # bridge is funded from cash, taxable, Roth contributions, and matured
    # conversions; trad sits last as a penalty-paying last resort.
    order: list[WithdrawalSource] = Field(
        default_factory=lambda: [
            WithdrawalSource.cash,
            WithdrawalSource.taxable,
            WithdrawalSource.roth_basis,
            WithdrawalSource.roth_matured_conversions,
            WithdrawalSource.trad,
            WithdrawalSource.hsa,
            WithdrawalSource.roth_earnings,
        ]
    )
    # 59.5 and after: tap traditional ahead of Roth so the Roth keeps compounding
    # tax-free as long as possible (Roth sources drawn last).
    late_order: list[WithdrawalSource] = Field(
        default_factory=lambda: [
            WithdrawalSource.cash,
            WithdrawalSource.taxable,
            WithdrawalSource.trad,
            WithdrawalSource.hsa,
            WithdrawalSource.roth_matured_conversions,
            WithdrawalSource.roth_basis,
            WithdrawalSource.roth_earnings,
        ]
    )
    # Keep this much cash (today's dollars) untouched as a buffer.
    cash_buffer: float = 10000.0
    # Last resort: tap traditional accounts before 59.5 paying the 10% penalty.
    allow_early_trad_with_penalty: bool = True

    def order_for_age(self, age: int, penalty_free_age: int) -> list[WithdrawalSource]:
        """Pre-59.5 vs 59.5+ ordering. Availability is still age-gated downstream
        in plan_withdrawals; this only chooses the *preference* order."""
        return self.order if age < penalty_free_age else self.late_order


class ConversionRule(BaseModel):
    """Roth conversion ladder. Conversions are ordinary income in the conversion
    year and become penalty-free withdrawals after 5 tax years."""

    kind: Literal["none", "fixed", "fill_bracket"] = "none"
    annual_amount: float = 0.0  # today's dollars, kind="fixed"
    bracket_top: Literal["std_deduction", "10", "12", "22", "custom"] = "12"
    # kind="fill_bracket", bracket_top="custom": fill ordinary income to this
    # taxable-income ceiling (today's dollars), letting you target a point between
    # the named brackets (e.g. 80k, between the 12% top 50,400 and 22% top 105,700).
    custom_top: float = 0.0
    start_age: Optional[int] = None  # default: retirement age
    end_age: Optional[int] = None  # default: 72 (lifetime ladder: bridge + pre-RMD drawdown)


class SocialSecurity(BaseModel):
    monthly_at_fra: float = 0.0  # today's dollars, from ssa.gov statement
    claiming_age: int = 67
    haircut: float = 1.0  # 1.0 / 0.75 / 0.50 / 0.25 / 0.0


# PIA adjustment by claiming age, FRA=67 (born 1960+).
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
    See docs/ASSUMPTIONS.md #27."""

    enabled: bool = False
    start_age: int = 65
    brackets: list[IRMAABracket] = Field(default_factory=default_irmaa_brackets)


class EventKind(str, Enum):
    one_time_flow = "one_time_flow"
    regime_change = "regime_change"
    crash = "crash"


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
    # one_time_flow: positive = outflow/expense, negative = windfall/inflow.
    amount: float = 0.0
    # one_time_flow: pull from this account specifically; None = withdrawal policy.
    # For windfalls, the destination account (default taxable).
    account: Optional[AccountType] = None
    # crash: returns applied INSTEAD of the sampled returns that year.
    stock_return: Optional[float] = None
    bond_return: Optional[float] = None
    overrides: Optional[RegimeOverrides] = None


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


class Scenario(BaseModel):
    schema_version: int = SCHEMA_VERSION
    name: str = "Default"
    profile: Profile = Profile()
    accounts: list[Account] = Field(default_factory=list)
    allocation: Allocation = Allocation()
    market: MarketModel = MarketModel()
    inflation: InflationModel = InflationModel()
    income: Income = Income()
    retirement_age: int = 65
    expense_streams: list[ExpenseStream] = Field(default_factory=list)
    liabilities: list[Liability] = Field(default_factory=list)
    waterfall: list[WaterfallStep] = Field(default_factory=default_waterfall)
    withdrawal_policy: WithdrawalPolicy = WithdrawalPolicy()
    conversion_rule: ConversionRule = ConversionRule()
    social_security: SocialSecurity = SocialSecurity()
    hsa: HSARule = HSARule()
    guardrails: GuardrailRule = GuardrailRule()
    spending_strategy: SpendingStrategy = SpendingStrategy()
    aca: ACAConfig = ACAConfig()
    irmaa: IRMAAConfig = IRMAAConfig()
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
