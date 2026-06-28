"""Home ownership: one config from which the engine derives the whole home.

A `HousingConfig` is the single source of truth for a primary residence. From
it the engine derives — deterministically, off the mean-inflation path — the
mortgage (a nominal contract), the down payment and closing costs, the ongoing
property-tax / insurance / maintenance / PMI costs, the home's appreciating
value, and an optional sale that converts equity to liquid wealth.

All user-facing inputs are in **today's dollars** (or rates). The engine sizes
the nominal mortgage internally so the today's-$ inputs and the nominal loan can
never drift apart — the unit-mismatch and double-count traps of hand-assembling
a `Liability` + a down-payment event + expense streams become impossible by
construction.

The home is an **asset overlay**: its value is reported in a "net worth including
home equity" line, but it stays OUT of the withdrawal / FIRE-success math — you
can't eat your house, so counting it as spendable would overstate sustainability.
See docs/ASSUMPTIONS.md.

v1 models a fresh purchase at `purchase_age` (>= the plan's start age). A
mid-amortization home you already own is still best modeled with a manual
`Liability`; that path is unchanged.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

from .enums import AccountType


class HousingConfig(BaseModel):
    """A primary residence: purchase, mortgage, carrying costs, and optional sale.

    Off by default — existing scenarios are unaffected until you enable it. The
    seed defaults anchor to a frugal, living-alone Madison / Dane County (WI)
    buyer (June 2026): a ~$350k home, 6.5% 30-yr fixed, ~1.7% property tax.
    """

    enabled: bool = False

    # ---- Purchase (today's dollars) -------------------------------------
    purchase_age: int = 30  # age at purchase; v1 expects >= the plan's start age
    home_price: float = 350000.0  # today's $, purchase price
    down_payment_pct: float = 0.20  # fraction of price paid up front
    closing_costs_pct: float = 0.03  # of price, paid up front (today's $)
    # Account the up-front cash is drawn from; None = use the withdrawal policy
    # (draw per the scenario's ordered sources, like a general outflow event).
    down_payment_account: Optional[AccountType] = AccountType.taxable

    # ---- Mortgage (a nominal contract once originated) ------------------
    loan_term_years: int = 30
    loan_type: Literal["fixed", "arm"] = "fixed"
    mortgage_rate: float = 0.065  # annual nominal; fixed rate, or ARM's initial rate
    points: float = 0.0  # discount points: % of loan paid up front (today's $)
    # ARM only: hold mortgage_rate for arm_fixed_years, then step to arm_reset_rate
    # for the remaining term (a single documented reset; no annual caps modeled).
    arm_fixed_years: int = 5
    arm_reset_rate: float = 0.075

    # ---- Ongoing carrying costs -----------------------------------------
    property_tax_rate: float = 0.017  # of home value per year (Dane County ~1.71%)
    insurance_annual: float = 1673.0  # today's $ (Madison ~$1,673 for $300k dwelling)
    maintenance_pct: float = 0.01  # of home value per year (1% rule of thumb)
    appreciation_real: float = 0.0  # real appreciation OVER inflation (nominal = +mean CPI)
    # Private mortgage insurance while loan-to-(original)-value exceeds 80%; it
    # auto-terminates at 78% LTV (Homeowners Protection Act). 0 if down >= 20%.
    pmi_rate: float = 0.0075  # of the original loan per year

    # ---- Sale / downsize (optional) -------------------------------------
    sale_age: Optional[int] = None  # sell at this age; net equity goes liquid
    selling_costs_pct: float = 0.06  # realtor + closing at sale (of sale price)
    cap_gains_exclusion: float = 250000.0  # today's $, single-filer primary-residence §121
    cap_gains_rate: float = 0.15  # flat LTCG rate on the gain above the exclusion
    sale_proceeds_account: AccountType = AccountType.taxable  # where net proceeds land

    # ---- Taxes ----------------------------------------------------------
    # Itemize mortgage interest + (SALT-capped) property tax when it beats the
    # standard deduction; off = always take the standard deduction.
    itemize_deductions: bool = True
