"""Probe non-monotonicity drivers: salary events, windfalls, forced-account expenses."""
import json
from pathlib import Path

from fire_engine import Scenario
from fire_engine import metrics as m
from fire_engine.scenario import AccountType, Event, EventKind, RegimeOverrides

ws = json.loads(Path.home().joinpath("AppData/Roaming/fire-app/workspace.json").read_text())
base = Scenario.model_validate(ws)

cases = {
    "new salary 40k at 50": [Event(kind=EventKind.regime_change, name="Barista", age=50,
                                   overrides=RegimeOverrides(gross_salary=40000))],
    "windfall -200k at 50 (income)": [Event(kind=EventKind.one_time_flow, name="Inherit",
                                            age=50, amount=-200000)],
    "expense 150k at 50 from brokerage": [Event(kind=EventKind.one_time_flow, name="House",
                                                age=50, amount=150000,
                                                account=AccountType.taxable)],
    "expenses 100k@48 + 100k@52": [
        Event(kind=EventKind.one_time_flow, name="A", age=48, amount=100000),
        Event(kind=EventKind.one_time_flow, name="B", age=52, amount=100000)],
}

for label, events in cases.items():
    s = base.model_copy(deep=True)
    s.events = events
    sweep = m.retirement_sweep(s, ages=list(range(42, 61)), n_paths=800)
    line = " ".join(f"{a}:{p:.2f}" for a, p in sorted(sweep.items()))
    drops = [(a, round(sweep[a] - sweep[a - 1], 3)) for a in sorted(sweep)
             if a - 1 in sweep and sweep[a] < sweep[a - 1] - 0.005]
    print(f"{label}\n  {line}\n  drops: {drops}\n")
