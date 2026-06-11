"""fire_engine: pure simulation library for the FIRE projection app.

No UI or server imports belong in this package. The FastAPI sidecar in
server/ is a thin wrapper around `run`, `sample_paths`, and `metrics`.
"""

from .engine import SimResult, run
from .sampling import MarketPaths, sample_paths
from .scenario import SCHEMA_VERSION, Scenario, example_scenario

__all__ = [
    "SCHEMA_VERSION",
    "Scenario",
    "SimResult",
    "MarketPaths",
    "example_scenario",
    "run",
    "sample_paths",
]
