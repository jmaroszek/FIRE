"""Probe: why does the accessibility (liquidity) chart show so little
roth_basis / matured conversions on Jonah's workspace?"""
import json
from pathlib import Path

import numpy as np

from fire_engine import Scenario, run

ws = json.loads(Path.home().joinpath("AppData/Roaming/fire-app/workspace.json").read_text())
s = Scenario.model_validate(ws)
print(f"retire={s.retirement_age} conv={s.conversion_rule.kind} "
      f"conv_end={s.conversion_rule.end_age} policy={[o.value for o in s.withdrawal_policy.order[:4]]}")

r = run(s)
deflate = r.cum_inflation[:, 1:]
print(f"\n{'age':>4} {'roth_basis':>12} {'matured_conv':>13} {'taxable':>12} "
      f"{'cash':>10} {'conversions':>12} {'roth_pool':>12}")
for age in range(40, 62):
    t = age - s.start_age
    row = {src: np.median(series[:, t] / deflate[:, t])
           for src, series in r.accessible.items()}
    conv = np.median(r.conversions[:, t] / deflate[:, t])
    roth = np.median(r.pools["roth"][:, t + 1] / r.cum_inflation[:, t + 1])
    print(f"{age:>4} {row['roth_basis']:>12,.0f} {row['roth_matured_conversions']:>13,.0f} "
          f"{row['taxable']:>12,.0f} {row['cash']:>10,.0f} {conv:>12,.0f} {roth:>12,.0f}")
