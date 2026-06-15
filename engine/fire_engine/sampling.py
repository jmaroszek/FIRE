"""Market path generation.

Two modes:
- parametric: IID lognormal real returns per asset (calibrated so the geometric
  mean equals the entered real CAGR) combined with AR(1) inflation.
- bootstrap (default): stationary block bootstrap (Politis-Romano, geometric
  block lengths) over joint annual rows (stock real, bond real, inflation) from
  the Shiller dataset 1871-2022. Sampling rows jointly preserves stock-bond-
  inflation cross-correlation and within-block serial structure.

Cash has no historical series in the dataset; its nominal return is modeled as
inflation + cash real CAGR in both modes (see ASSUMPTIONS.md).

Scheduled crash events REPLACE the sampled return in their year (deterministic
stress overlay; random crashes are deliberately not modeled to avoid double-
counting against historically calibrated returns).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .scenario import EventKind, Scenario

DATA_DIR = Path(__file__).parent / "data"


@dataclass
class MarketPaths:
    """Nominal annual returns and inflation, shape (n_paths, n_years).

    cum_inflation has shape (n_paths, n_years + 1): cum_inflation[:, t] converts
    year-t (start-of-year) dollars to today's dollars; index 0 is 1.0.
    """

    stock: np.ndarray
    bond: np.ndarray
    cash: np.ndarray
    inflation: np.ndarray
    cum_inflation: np.ndarray
    # Standard-normal shocks (n_paths, n_years) shared across income streams that
    # carry volatility; each stream scales it by its own sigma. None = no income
    # noise (deterministic mode, or no variable streams). See engine wages calc.
    income_z: np.ndarray | None = None

    @property
    def n_paths(self) -> int:
        return self.stock.shape[0]

    @property
    def n_years(self) -> int:
        return self.stock.shape[1]


_historical_cache: dict[str, np.ndarray] | None = None


def load_historical() -> dict[str, np.ndarray]:
    global _historical_cache
    if _historical_cache is None:
        rows = list(csv.DictReader((DATA_DIR / "historical_annual.csv").open()))
        _historical_cache = {
            key: np.array([float(r[key]) for r in rows])
            for key in ("stock_real", "bond_real", "inflation")
        }
    return _historical_cache


def _ar1_inflation(scenario: Scenario, n_paths: int, n_years: int,
                   rng: np.random.Generator) -> np.ndarray:
    m = scenario.inflation
    if m.sigma == 0.0 and m.persistence == 0.0:
        return np.full((n_paths, n_years), m.mean)
    pi = np.empty((n_paths, n_years))
    prev = np.full(n_paths, m.initial)
    eps = rng.normal(0.0, m.sigma, size=(n_paths, n_years))
    for t in range(n_years):
        prev = m.mean + m.persistence * (prev - m.mean) + eps[:, t]
        pi[:, t] = prev
    return pi


def _lognormal_real(cagr: float, vol: float, size: tuple[int, int],
                    rng: np.random.Generator) -> np.ndarray:
    """IID real returns whose geometric mean is `cagr`."""
    if vol == 0.0:
        return np.full(size, cagr)
    sigma_log = vol / (1.0 + cagr)
    return np.exp(rng.normal(np.log1p(cagr), sigma_log, size=size)) - 1.0


def _stationary_bootstrap_indices(n_obs: int, n_paths: int, n_years: int,
                                  mean_block: float, rng: np.random.Generator) -> np.ndarray:
    """Index matrix (n_paths, n_years) into the historical series: geometric
    block lengths with mean `mean_block`, wrapping at the series end."""
    p_new = 1.0 / max(mean_block, 1.0)
    new_block = rng.random((n_paths, n_years)) < p_new
    new_block[:, 0] = True
    starts = rng.integers(0, n_obs, size=(n_paths, n_years))
    idx = np.empty((n_paths, n_years), dtype=np.int64)
    current = starts[:, 0]
    for t in range(n_years):
        current = np.where(new_block[:, t], starts[:, t], (current + 1) % n_obs)
        idx[:, t] = current
    return idx


def sample_paths(scenario: Scenario, n_paths: int | None = None,
                 deterministic: bool = False) -> MarketPaths:
    """Generate market paths for a scenario.

    deterministic=True returns a single zero-variance path at the entered real
    CAGRs and mean inflation (used for Coast FIRE and simple projections).
    """
    n_years = scenario.n_years
    rng = np.random.default_rng(scenario.sim.seed)
    market = scenario.market

    if deterministic:
        n_paths = 1
        inflation = np.full((1, n_years), scenario.inflation.mean)
        stock_real = np.full((1, n_years), market.stocks.real_cagr)
        bond_real = np.full((1, n_years), market.bonds.real_cagr)
    else:
        n_paths = n_paths or scenario.sim.n_paths
        inflation = _ar1_inflation(scenario, n_paths, n_years, rng)
        if market.mode == "parametric":
            stock_real = _lognormal_real(market.stocks.real_cagr, market.stocks.vol,
                                         (n_paths, n_years), rng)
            bond_real = _lognormal_real(market.bonds.real_cagr, market.bonds.vol,
                                        (n_paths, n_years), rng)
        else:
            hist = load_historical()
            n_obs = len(hist["inflation"])
            idx = _stationary_bootstrap_indices(n_obs, n_paths, n_years,
                                                market.bootstrap_mean_block, rng)
            stock_real = hist["stock_real"][idx]
            bond_real = hist["bond_real"][idx]
            inflation = hist["inflation"][idx]  # joint rows: keep historical inflation
            if market.bootstrap_mean_shift:
                for series, target in ((stock_real, market.stocks.real_cagr),
                                       (bond_real, market.bonds.real_cagr)):
                    hist_cagr = np.expm1(np.mean(np.log1p(
                        hist["stock_real"] if series is stock_real else hist["bond_real"])))
                    series += target - hist_cagr

    cash_real = np.full_like(inflation, market.cash.real_cagr)

    stock = (1 + stock_real) * (1 + inflation) - 1
    bond = (1 + bond_real) * (1 + inflation) - 1
    cash = (1 + cash_real) * (1 + inflation) - 1

    # Crash events replace that year's sampled returns.
    for event in scenario.events:
        if event.kind is EventKind.crash:
            t = scenario.event_year_index(event)
            if 0 <= t < n_years:
                if event.stock_return is not None:
                    stock[:, t] = event.stock_return
                if event.bond_return is not None:
                    bond[:, t] = event.bond_return

    cum = np.ones((stock.shape[0], n_years + 1))
    np.cumprod(1 + inflation, axis=1, out=cum[:, 1:])
    # Per-path income shocks for any volatile income streams (engine applies the
    # per-stream sigma). Deterministic projections stay noise-free.
    income_z = None if deterministic else rng.standard_normal((stock.shape[0], n_years))
    return MarketPaths(stock=stock, bond=bond, cash=cash,
                       inflation=inflation, cum_inflation=cum, income_z=income_z)
