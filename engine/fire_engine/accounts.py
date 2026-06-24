"""Portfolio state and withdrawal mechanics, vectorized across paths.

Account types merge into five tax pools (taxable, traditional, Roth, HSA, cash);
per-account granularity below the pool level is not tax-relevant (ASSUMPTIONS.md).

Roth accounting follows IRS ordering: direct contribution basis first, then
conversion principal (FIFO, penalty-free 5 tax years after conversion or at
59.5+), then earnings (qualified at 59.5+). The annual grain means "59.5" is
implemented as the year the simulated person turns 60.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .scenario import (
    Account,
    AccountType,
    ROTH_TYPES,
    TRAD_TYPES,
    Scenario,
    WithdrawalSource,
)

PENALTY_FREE_AGE = 60  # annual-grain stand-in for 59.5
HSA_PENALTY_FREE_AGE = 65
CONVERSION_SEASONING_YEARS = 5


class PortfolioState:
    """All balances are (n_paths,) float arrays in nominal dollars."""

    def __init__(self, scenario: Scenario, n_paths: int, balance_scale: float = 1.0):
        z = lambda: np.zeros(n_paths)
        self.n_paths = n_paths
        self.taxable = z()
        self.taxable_basis = z()
        self.trad = z()
        self.roth = z()
        self.roth_contrib_basis = z()
        self.conv_total = z()  # all conversion principal still in the Roth
        self.conv_matured = z()  # seasoned (5yr) conversion principal
        self.hsa = z()
        self.cash = z()
        # conversions made during the sim, by sim-year index (for seasoning)
        self.conv_by_year: dict[int, np.ndarray] = {}
        # pre-existing conversions scheduled to mature at sim-year index
        self.pending_maturity: dict[int, float] = {}

        for acc in scenario.accounts:
            bal = acc.balance * balance_scale
            if acc.type is AccountType.taxable:
                self.taxable += bal
                basis = acc.cost_basis if acc.cost_basis is not None else acc.balance
                self.taxable_basis += basis * balance_scale
            elif acc.type in TRAD_TYPES:
                self.trad += bal
            elif acc.type in ROTH_TYPES:
                self.roth += bal
                self.roth_contrib_basis += acc.roth_contribution_basis * balance_scale
                for year, amount in acc.roth_conversions.items():
                    amt = amount * balance_scale
                    self.conv_total += amt
                    t_mature = int(year) + CONVERSION_SEASONING_YEARS - scenario.sim.start_year
                    if t_mature <= 0:
                        self.conv_matured += amt
                    else:
                        self.pending_maturity[t_mature] = (
                            self.pending_maturity.get(t_mature, 0.0) + amt
                        )
            elif acc.type is AccountType.hsa:
                self.hsa += bal
            elif acc.type is AccountType.cash:
                self.cash += bal

    def season_conversions(self, t: int) -> None:
        """At sim-year t, conversions made at t-5 (and scheduled pre-existing
        rungs) become penalty-free."""
        if t in self.pending_maturity:
            self.conv_matured += self.pending_maturity.pop(t)
        rung = self.conv_by_year.get(t - CONVERSION_SEASONING_YEARS)
        if rung is not None:
            self.conv_matured += rung

    def convert(self, amount: np.ndarray, t: int) -> None:
        amount = np.minimum(amount, self.trad)
        self.trad -= amount
        self.roth += amount
        self.conv_total += amount
        self.conv_by_year[t] = self.conv_by_year.get(t, 0) + amount

    def total_net_worth(self) -> np.ndarray:
        return self.taxable + self.trad + self.roth + self.hsa + self.cash

    def grow(self, blended_return: np.ndarray, cash_return: np.ndarray,
             hsa_cash_buffer: np.ndarray | float = 0.0) -> None:
        """Apply end-of-year returns. Invested pools earn the allocation-blended
        return; the cash pool earns the cash return. The first `hsa_cash_buffer`
        nominal dollars of the HSA stay uninvested at the cash return. Basis
        amounts are nominal and do not grow."""
        factor = 1.0 + blended_return
        self.taxable *= factor
        self.trad *= factor
        self.roth *= factor
        hsa_invested = np.maximum(self.hsa - hsa_cash_buffer, 0.0)
        hsa_parked = self.hsa - hsa_invested
        self.hsa = hsa_parked * (1.0 + cash_return) + hsa_invested * factor
        self.cash *= 1.0 + cash_return

    def accessible(self, age: int) -> dict[str, np.ndarray]:
        """Penalty-free accessible dollars by source at a given age."""
        matured = self.conv_total if age >= PENALTY_FREE_AGE else self.conv_matured
        out = {
            "cash": self.cash.copy(),
            "taxable": self.taxable.copy(),
            "roth_basis": np.minimum(self.roth_contrib_basis, self.roth),
            "roth_matured_conversions": np.minimum(matured, self.roth),
        }
        out["trad"] = self.trad.copy() if age >= PENALTY_FREE_AGE else np.zeros(self.n_paths)
        out["hsa"] = self.hsa.copy() if age >= HSA_PENALTY_FREE_AGE else np.zeros(self.n_paths)
        roth_used = out["roth_basis"] + out["roth_matured_conversions"]
        out["roth_earnings"] = (
            np.maximum(self.roth - roth_used, 0.0)
            if age >= PENALTY_FREE_AGE
            else np.zeros(self.n_paths)
        )
        return out


@dataclass
class WithdrawalPlan:
    """A computed (not yet applied) set of withdrawals for one year."""

    takes: dict[WithdrawalSource, np.ndarray] = field(default_factory=dict)
    shortfall: np.ndarray | None = None
    # tax characterization
    ordinary_income: np.ndarray | None = None  # trad + HSA(65+) withdrawals
    ltcg_income: np.ndarray | None = None  # realized gains from taxable sales
    penalty_base: np.ndarray | None = None  # early trad withdrawals (10% penalty)


def plan_withdrawals(
    state: PortfolioState,
    need: np.ndarray,
    age: int,
    order: list[WithdrawalSource],
    cash_buffer_nominal: np.ndarray,
    allow_early_trad: bool,
    forced: dict[WithdrawalSource, np.ndarray] | None = None,
    trad_ordinary_cap: np.ndarray | None = None,
) -> WithdrawalPlan:
    """Plan withdrawals to cover `need`, walking the policy order.

    Pure planning: reads balances, never mutates. `forced` takes (from
    one-time events with an explicit source account) are drawn first from
    their source regardless of policy order; any unfillable forced amount
    spills into the general need.

    `trad_ordinary_cap` (nominal $, per path) activates bracket-filled
    decumulation: the combined traditional + HSA(65+) draw — both ordinary
    income — is held to this ceiling during the ordered walk, so spending
    above it spills to the next source (Roth) instead of climbing a bracket.
    Forced ordinary takes consume the cap first. If `need` still isn't met
    after the ordered walk, a fallback pass draws traditional then HSA
    uncapped (accepting the higher bracket) before the cash-buffer last
    resort — spending never fails just because Roth ran dry. `None` (the
    default) reproduces the strict-order behavior exactly.
    """
    P = state.n_paths
    early = age < PENALTY_FREE_AGE
    matured_avail = state.conv_total if not early else state.conv_matured

    avail = {
        WithdrawalSource.cash: np.maximum(state.cash - cash_buffer_nominal, 0.0),
        WithdrawalSource.taxable: state.taxable.copy(),
        WithdrawalSource.roth_basis: np.minimum(state.roth_contrib_basis, state.roth),
        WithdrawalSource.roth_matured_conversions: np.minimum(matured_avail, state.roth),
        WithdrawalSource.trad: (
            state.trad.copy() if (not early or allow_early_trad) else np.zeros(P)
        ),
        WithdrawalSource.hsa: (
            state.hsa.copy() if age >= HSA_PENALTY_FREE_AGE else np.zeros(P)
        ),
        WithdrawalSource.roth_earnings: (
            np.zeros(P)
            if early
            else np.maximum(
                state.roth
                - np.minimum(state.roth_contrib_basis, state.roth)
                - np.minimum(matured_avail, state.roth),
                0.0,
            )
        ),
    }

    takes = {src: np.zeros(P) for src in avail}
    remaining = need.astype(float).copy()

    # Bracket-filled decumulation: traditional and HSA(65+) are both ordinary
    # income and share this per-year headroom; once spent, the ordered walk
    # routes further need to the next (Roth) source rather than overshooting.
    ORDINARY = (WithdrawalSource.trad, WithdrawalSource.hsa)
    ord_budget = None if trad_ordinary_cap is None else np.maximum(trad_ordinary_cap, 0.0).copy()

    if forced:
        for src, amount in forced.items():
            take = np.minimum(amount, avail[src])
            takes[src] += take
            avail[src] -= take
            remaining += amount - take  # unfillable forced amount -> general need
            if ord_budget is not None and src in ORDINARY:
                ord_budget = np.maximum(ord_budget - take, 0.0)  # forced ordinary uses headroom first

    for src in order:
        cap = avail[src]
        if ord_budget is not None and src in ORDINARY:
            cap = np.minimum(cap, ord_budget)
        take = np.minimum(remaining, cap)
        takes[src] += take
        avail[src] -= take
        remaining -= take
        if ord_budget is not None and src in ORDINARY:
            ord_budget = ord_budget - take

    # Bracket-filled fallback: if Roth couldn't cover the spending above the
    # ceiling, draw traditional then HSA uncapped (eating the higher bracket)
    # before touching the cash buffer — a funded year beats a smooth one.
    if trad_ordinary_cap is not None:
        for src in ORDINARY:
            take = np.minimum(remaining, avail[src])
            takes[src] += take
            avail[src] -= take
            remaining -= take

    # Last resort: the cash buffer is an emergency reserve, not an untouchable
    # floor. If spending still isn't met after walking the full order, tap
    # whatever cash remains (the held-back buffer) before recording a shortfall
    # — in a year you'd otherwise go broke, you spend your emergency cash too.
    # This also lets the worst-case accessible balance fall to zero rather than
    # bottoming out at the buffer.
    buffer_left = np.maximum(state.cash - takes[WithdrawalSource.cash], 0.0)
    last_resort = np.minimum(remaining, buffer_left)
    takes[WithdrawalSource.cash] += last_resort
    remaining -= last_resort

    plan = WithdrawalPlan(takes=takes, shortfall=remaining)
    trad_take = takes[WithdrawalSource.trad]
    plan.ordinary_income = trad_take + takes[WithdrawalSource.hsa]
    gain_fraction = np.divide(
        np.maximum(state.taxable - state.taxable_basis, 0.0),
        state.taxable,
        out=np.zeros(P),
        where=state.taxable > 0,
    )
    plan.ltcg_income = takes[WithdrawalSource.taxable] * gain_fraction
    plan.penalty_base = trad_take if early else np.zeros(P)
    return plan


def apply_plan(state: PortfolioState, plan: WithdrawalPlan, age: int) -> None:
    takes = plan.takes
    state.cash -= takes[WithdrawalSource.cash]

    taxable_take = takes[WithdrawalSource.taxable]
    basis_fraction = np.divide(
        state.taxable_basis, state.taxable,
        out=np.zeros(state.n_paths), where=state.taxable > 0,
    )
    state.taxable_basis -= taxable_take * np.minimum(basis_fraction, 1.0)
    state.taxable -= taxable_take

    basis_take = takes[WithdrawalSource.roth_basis]
    state.roth_contrib_basis -= basis_take
    state.roth -= basis_take

    conv_take = takes[WithdrawalSource.roth_matured_conversions]
    state.conv_total -= conv_take
    state.roth -= conv_take
    if age < PENALTY_FREE_AGE:
        state.conv_matured -= conv_take
    else:
        state.conv_matured = np.minimum(state.conv_matured, state.conv_total)

    state.trad -= takes[WithdrawalSource.trad]
    state.hsa -= takes[WithdrawalSource.hsa]
    state.roth -= takes[WithdrawalSource.roth_earnings]

    # numerical hygiene
    for arr in (state.taxable, state.taxable_basis, state.trad, state.roth,
                state.roth_contrib_basis, state.conv_total, state.conv_matured,
                state.hsa, state.cash):
        np.maximum(arr, 0.0, out=arr)
