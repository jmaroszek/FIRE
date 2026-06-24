"""Shared metric helpers: the flow deflator and percentile fan."""

from __future__ import annotations

import numpy as np

from ..engine import SimResult

DEFAULT_PERCENTILES = (5, 25, 50, 75, 95)


def _flow_deflator(result: SimResult) -> np.ndarray:
    """Deflator for year-t *flows* (taxes, expenses, contributions, conversions).

    The engine computes flows at start-of-year prices, cum_inflation[:, t], so
    they convert back to today's dollars with column t — i.e. cum_inflation[:, :-1].
    End-of-year *stocks* (net worth, pools, accessibility) deflate with [:, 1:].
    Using [:, 1:] for a flow over-deflates it by one year of inflation (~2%),
    which is why a contribution pinned to its IRS cap showed up just under it."""
    return result.cum_inflation[:, :-1]


def percentile_fan(result: SimResult,
                   percentiles=DEFAULT_PERCENTILES) -> dict[str, dict[str, list[float]]]:
    """Net-worth percentile bands over time, nominal and real (today's $)."""
    nominal = result.net_worth
    real = nominal / result.cum_inflation
    out: dict[str, dict[str, list[float]]] = {"nominal": {}, "real": {}}
    for p in percentiles:
        out["nominal"][f"p{p}"] = np.percentile(nominal, p, axis=0).tolist()
        out["real"][f"p{p}"] = np.percentile(real, p, axis=0).tolist()
    return out
