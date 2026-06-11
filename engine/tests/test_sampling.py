"""Market path generation: shapes, reproducibility, bootstrap properties,
crash overlays, AR(1) inflation."""

import numpy as np
import pytest

from fire_engine.sampling import load_historical, sample_paths
from fire_engine.scenario import Event, EventKind, InflationModel, MarketModel, Scenario


def base_scenario(**kwargs) -> Scenario:
    return Scenario(**kwargs)


def test_shapes_and_reproducibility():
    s = base_scenario()
    a = sample_paths(s, n_paths=50)
    b = sample_paths(s, n_paths=50)
    assert a.stock.shape == (50, s.n_years)
    assert a.cum_inflation.shape == (50, s.n_years + 1)
    assert np.array_equal(a.stock, b.stock)  # same seed -> same paths
    assert np.all(a.cum_inflation[:, 0] == 1.0)


def test_bootstrap_draws_from_history():
    s = base_scenario()
    hist = load_historical()
    paths = sample_paths(s, n_paths=20)
    # every sampled real-return-derived nominal value must exist in history
    nominal_hist = (1 + hist["stock_real"]) * (1 + hist["inflation"]) - 1
    sample = paths.stock[:5, :10].ravel()
    for v in sample:
        assert np.any(np.isclose(nominal_hist, v, atol=1e-9))


def test_parametric_zero_vol_hits_cagr():
    s = base_scenario(
        market=MarketModel(mode="parametric",
                           stocks={"real_cagr": 0.05, "vol": 0.0},
                           bonds={"real_cagr": 0.02, "vol": 0.0},
                           cash={"real_cagr": 0.0, "vol": 0.0}),
        inflation=InflationModel(mean=0.0, persistence=0.0, sigma=0.0, initial=0.0),
    )
    paths = sample_paths(s, n_paths=3)
    assert np.allclose(paths.stock, 0.05)
    assert np.allclose(paths.bond, 0.02)
    assert np.allclose(paths.cum_inflation, 1.0)


def test_ar1_constant_when_sigma_zero():
    s = base_scenario(
        market=MarketModel(mode="parametric"),
        inflation=InflationModel(mean=0.03, persistence=0.0, sigma=0.0, initial=0.03),
    )
    paths = sample_paths(s, n_paths=4)
    assert np.allclose(paths.inflation, 0.03)


def test_crash_event_overrides_returns():
    s = base_scenario(events=[
        Event(kind=EventKind.crash, year=2030, stock_return=-0.40, bond_return=-0.10)
    ])
    t = 2030 - s.sim.start_year
    paths = sample_paths(s, n_paths=10)
    assert np.allclose(paths.stock[:, t], -0.40)
    assert np.allclose(paths.bond[:, t], -0.10)


def test_deterministic_single_path():
    s = base_scenario()
    paths = sample_paths(s, deterministic=True)
    assert paths.n_paths == 1
    assert np.allclose(paths.inflation, s.inflation.mean)
    expected_nominal = (1 + s.market.stocks.real_cagr) * (1 + s.inflation.mean) - 1
    assert np.allclose(paths.stock, expected_nominal)


def test_historical_dataset_sane():
    hist = load_historical()
    n = len(hist["inflation"])
    assert n >= 140
    stock_cagr = np.expm1(np.mean(np.log1p(hist["stock_real"])))
    bond_cagr = np.expm1(np.mean(np.log1p(hist["bond_real"])))
    assert 0.05 < stock_cagr < 0.08  # ~6.9% real, published value
    assert 0.01 < bond_cagr < 0.04  # ~2.5% real
