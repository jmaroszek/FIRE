"""Probe: reconcile fire_number_mc vs retirement sweep on Jonah's workspace."""
import json
from pathlib import Path

import numpy as np

from fire_engine import Scenario, run
from fire_engine import metrics as m
from fire_engine.sampling import sample_paths

ws = json.loads(Path.home().joinpath("AppData/Roaming/fire-app/workspace.json").read_text())
s = Scenario.model_validate(ws)
print(f"start_age={s.start_age}  retire={s.retirement_age}  threshold={s.sim.success_threshold}")

fire_mc = m.fire_number_mc(s, n_paths=1000)
print(f"fire_number_mc (retire TODAY at {s.start_age}): {fire_mc:,.0f}")
print(f"fire_number_simple (25x): {m.fire_number_simple(s):,.0f}")

paths = sample_paths(s, n_paths=1000)
base = run(s, paths=paths)
real_nw = base.net_worth[:, 1:] / base.cum_inflation[:, 1:]
med = np.median(real_nw, axis=0)

sweep = m.retirement_sweep(s, n_paths=1000)
print("\nage  success  median real NW at that age (baseline retire-45 run)")
for age in sorted(sweep):
    t = age - s.start_age
    nw = med[t - 1] if t > 0 else np.median(base.net_worth[:, 0])
    print(f"{age:3d}  {sweep[age]:7.3f}  {nw:12,.0f}")

# conditional: among paths whose real NW at age a is within +-15% of fire_mc,
# what fraction succeeds when retiring at a?
for probe_age in (38, 40, 42):
    t = probe_age - s.start_age
    r = run(s, paths=paths, retirement_age=probe_age)
    ok = ~r.fail.any(axis=1)
    nw_a = real_nw[:, t - 1]
    near = (nw_a > fire_mc * 0.85) & (nw_a < fire_mc * 1.15)
    if near.sum() > 10:
        print(f"\nretire@{probe_age}: overall success {ok.mean():.3f}; "
              f"among {near.sum()} paths with real NW ~ fire_mc: {ok[near].mean():.3f}")

# where does the money sit at age 40 (median, real)?
t40 = 40 - s.start_age
for pool, series in base.pools.items():
    print(f"pool {pool:8s} median real at 40: {np.median(series[:, t40] / base.cum_inflation[:, t40]):12,.0f}")
