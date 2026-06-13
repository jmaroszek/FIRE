"""Probe: does a large one-time expense make the retirement sweep non-monotonic?"""
import json
from pathlib import Path

import numpy as np

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.scenario import Event, EventKind

ws = json.loads(Path.home().joinpath("AppData/Roaming/fire-app/workspace.json").read_text())
s = Scenario.model_validate(ws)
s.events = [Event(kind=EventKind.one_time_flow, name="Big", age=50, amount=400000.0)]

for guard in (True, False):
    s.guardrails.enabled = guard
    sweep = m.retirement_sweep(s, ages=list(range(40, 61)), n_paths=1000)
    line = " ".join(f"{a}:{p:.2f}" for a, p in sorted(sweep.items()))
    print(f"guardrails={guard}\n{line}\n")
    drops = [(a, sweep[a] - sweep[a - 1]) for a in sorted(sweep) if a - 1 in sweep and sweep[a] < sweep[a - 1] - 1e-9]
    print(f"  non-monotone drops: {drops}\n")
