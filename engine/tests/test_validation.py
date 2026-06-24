"""Scenario invariant validation — the backend mirror of src/validate.ts.

These guard that a malformed scenario fails loudly with a readable message
(ValueError out of run()) instead of producing meaningless output or crashing
deep in the numerics on, e.g., a non-positive number of simulated years.
"""

import pytest

from fire_engine import Scenario, run
from fire_engine.scenario import example_scenario, validate_invariants


def test_clean_scenario_has_no_errors():
    assert validate_invariants(example_scenario()) == []


def test_horizon_at_or_before_current_age_errors():
    s = example_scenario()
    s.profile.horizon_age = s.start_age  # zero years to simulate
    errors = validate_invariants(s)
    assert any("horizon" in e for e in errors)


def test_retirement_past_horizon_is_runnable():
    # Odd but not engine-breaking: the person simply works the whole horizon.
    # The backend guard must NOT block it (it's a frontend-only advisory).
    s = example_scenario()
    s.retirement_age = s.profile.horizon_age + 5
    assert validate_invariants(s) == []


def test_allocation_must_sum_to_one():
    s = example_scenario()
    s.allocation.cash += 0.2  # now sums to 1.2
    assert any("allocation" in e for e in errors_of(s))


def test_n_paths_must_be_positive():
    s = example_scenario()
    s.sim.n_paths = 0
    assert any("n_paths" in e for e in errors_of(s))


def test_run_raises_valueerror_on_invalid_scenario():
    s = example_scenario()
    s.profile.horizon_age = 5  # current age ~26 -> no years
    with pytest.raises(ValueError, match="invalid scenario"):
        run(s)


def test_run_succeeds_on_clean_scenario():
    # The guard must not reject a valid scenario.
    s = example_scenario()
    s.sim.n_paths = 50
    result = run(s)
    assert result is not None


def errors_of(s: Scenario) -> list[str]:
    return validate_invariants(s)
