"""Spending strategy, guardrails, contribution waterfall, withdrawal & conversion policy."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .enums import AccountType, WithdrawalSource


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

    Two anchors:
    - `constant_dollar` (default): fund the plan's expense streams, optionally
      flexed by the Guyton-Klinger guardrails. Anchored to your dollar plan.
    - `percent_portfolio`: discretionary spending = `rate` × your penalty-free
      accessible wealth, essentials first. Anchored to your balance, so it
      self-corrects with the market and never depletes to zero. Toggles:
        * `rate_mode="fixed"` holds `rate` flat; `"vpw"` lets it rise with age
          via an annuity payout factor (assumes `vpw_real_return`), deliberately
          drawing the balance toward zero by the horizon.
        * `bounded` clips discretionary to [floor_mult, ceiling_mult] × the plan's
          discretionary amount — a stable floor and an upside cap.
        * `smoothing` (0..1) blends this year's portfolio-driven target with last
          year's realized spend (endowment/Yale rule), damping year-to-year swings.

    The percentage is taken on *accessible* (penalty-free) wealth, not total net
    worth, so before 59.5 it won't propose spending the trad/Roth-growth balances
    locked behind the early-withdrawal penalty. Essentials are funded first; a
    path still fails if accessible wealth can't cover them.

    Legacy `constant_pct` / `vpw` / `floor_ceiling` scenarios migrate to
    `percent_portfolio` (see `_migrate`).
    """
    kind: Literal["constant_dollar", "percent_portfolio"] = "constant_dollar"
    rate_mode: Literal["fixed", "vpw"] = "fixed"
    rate: float = 0.04             # fixed: share of accessible wealth spent each year
    vpw_real_return: float = 0.03  # vpw: assumed real return in the annuity payout factor
    bounded: bool = True           # clip discretionary to [floor_mult, ceiling_mult] × plan
    floor_mult: float = 0.75       # min fraction of plan discretionary (when bounded)
    ceiling_mult: float = 1.25     # max fraction of plan discretionary (when bounded)
    smoothing: float = 0.0         # 0..1 weight on last year's spend (endowment smoothing)

    @model_validator(mode="before")
    @classmethod
    def _migrate(cls, data):
        """Fold the old four-kind enum into the two-kind model. constant_pct and
        vpw were unbounded; floor_ceiling carried the bounds — preserved here so
        existing scenarios reproduce their prior behavior."""
        if not isinstance(data, dict):
            return data
        legacy = data.get("kind")
        if legacy in ("constant_pct", "vpw", "floor_ceiling"):
            data = dict(data)
            data["kind"] = "percent_portfolio"
            data["rate_mode"] = "vpw" if legacy == "vpw" else "fixed"
            data["bounded"] = legacy == "floor_ceiling"
        return data


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


class WaterfallSegment(BaseModel):
    """A contribution waterfall that takes effect from `start_age` onward (until
    the next segment overrides it). Lets contribution routing change over time —
    e.g. stop maxing the 401k and divert to taxable while saving for a house, or
    shift toward liquid savings approaching an early-retirement date. Before the
    first segment's start_age, the scenario's base `waterfall` applies."""

    start_age: int
    steps: list[WaterfallStep] = Field(default_factory=default_waterfall)


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
    # Tax-aware decumulation (59.5+ only). "priority": strict order above (the
    # traditional draw is uncapped). "bracket_filled": the traditional spending
    # draw is capped so its ordinary income tops out at `bracket_top`; spending
    # above that ceiling is funded from Roth instead of climbing into the next
    # bracket, and traditional is only tapped uncapped as a last resort if Roth
    # is exhausted. The Roth conversion ladder fills whatever bracket room the
    # spending draw leaves, so the two levers stay consistent. HSA (65+) is
    # ordinary income too and shares the cap. See docs/ASSUMPTIONS.md.
    mode: Literal["priority", "bracket_filled"] = "priority"
    # Ceiling for the capped traditional draw; mirrors ConversionRule. Defaults
    # to the 12% bracket top, the same default the ladder uses.
    bracket_top: Literal["std_deduction", "10", "12", "22", "custom"] = "12"
    custom_top: float = 0.0  # today's $ taxable-income ceiling, bracket_top="custom"

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
