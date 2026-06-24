"""Scenario data model, split by concern. Public API unchanged: import
names straight from `fire_engine.scenario`."""

from .enums import (
    SCHEMA_VERSION,
    AccountType,
    TRAD_TYPES,
    ROTH_TYPES,
    WithdrawalSource,
    EventKind,
)
from .market import (
    Account,
    Allocation,
    AssetParams,
    MarketModel,
    InflationModel,
    AllocationSegment,
)
from .income import (
    Income,
    IncomeStream,
)
from .expenses import (
    ExpenseStream,
    Liability,
)
from .spending import (
    GuardrailRule,
    TaxRegimeShock,
    SpendingStrategy,
    WaterfallStep,
    default_waterfall,
    WaterfallSegment,
    WithdrawalPolicy,
    ConversionRule,
)
from .health import (
    SocialSecurity,
    SS_CLAIMING_FACTORS,
    HSARule,
    ACAConfig,
    IRMAABracket,
    default_irmaa_brackets,
    IRMAAConfig,
    LTCConfig,
)
from .events import (
    RegimeOverrides,
    Event,
)
from .core import (
    Profile,
    SimSettings,
    Scenario,
    example_scenario,
)
