"""Probe: are the IRS-limit caps being hit, and is the real-dollar display
off by one year of inflation? Checks Roth IRA / 401k / HSA contributions
against their nominal caps, deflated two ways."""
import json
from pathlib import Path

import numpy as np

from fire_engine import Scenario, run
from fire_engine.engine import _contribution_limits

ws = json.loads(Path.home().joinpath("AppData/Roaming/fire-app/workspace.json").read_text())
s = Scenario.model_validate(ws)
print(f"retire={s.retirement_age}  waterfall={[ (w.account, w.kind) for w in s.waterfall ]}")
print(f"salary={s.income.gross_salary}  hsa_coverage={s.hsa.coverage}")

r = run(s)
cum = r.cum_inflation
end_deflate = cum[:, 1:]      # what metrics.py uses  -> column t+1
start_deflate = cum[:, :-1]   # the factor the flow was computed at -> column t

print(f"\n{'age':>4} {'roth$nom':>10} {'roth_cap_nom':>12} "
      f"{'real[t+1]':>10} {'real[t]':>10} {'cap_real':>9}  hit?")
for age in range(s.start_age, s.start_age + 12):
    t = age - s.start_age
    roth_nom = np.median(r.contrib_pools['roth'][:, t])
    # nominal cap for the IRA group this year (median across paths)
    cap_nom = np.median(_contribution_limits(age, cum[:, t], s.hsa.coverage)['ira'])
    real_tp1 = np.median(r.contrib_pools['roth'][:, t] / end_deflate[:, t])
    real_t = np.median(r.contrib_pools['roth'][:, t] / start_deflate[:, t])
    cap_real = 7500.0 + (1100.0 if age >= 50 else 0.0)
    hit = "Y" if roth_nom > 0.99 * cap_nom else "."
    print(f"{age:>4} {roth_nom:>10,.0f} {cap_nom:>12,.0f} "
          f"{real_tp1:>10,.0f} {real_t:>10,.0f} {cap_real:>9,.0f}   {hit}")

# brokerage jump at 75 (RMD reinvestment)?
print(f"\n{'age':>4} {'taxable_contrib_real':>20} {'rmd-ish? trad drop':>20}")
for age in range(72, 80):
    t = age - s.start_age
    if t < 0 or t >= r.contributions.shape[1]:
        continue
    tax_real = np.median(r.contrib_pools['taxable'][:, t] / end_deflate[:, t])
    print(f"{age:>4} {tax_real:>20,.0f}")
