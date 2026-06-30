"""Enumerations and module-level constants for the scenario model."""

from __future__ import annotations

from enum import Enum


SCHEMA_VERSION = 8  # v8: ACA coverage_start_age for delayed marketplace coverage


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


class WithdrawalSource(str, Enum):
    cash = "cash"
    taxable = "taxable"
    roth_basis = "roth_basis"  # direct contributions
    roth_matured_conversions = "roth_matured_conversions"  # 5-year rule satisfied
    trad = "trad"  # penalty-free at 59.5+; earlier only if allow_early_trad
    hsa = "hsa"  # non-medical, age 65+ (ordinary income)
    roth_earnings = "roth_earnings"  # qualified at 59.5+ only


class EventKind(str, Enum):
    one_time_flow = "one_time_flow"
    recurring_flow = "recurring_flow"
    regime_change = "regime_change"
    crash = "crash"
