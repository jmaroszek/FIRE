# FIRE App — Architecture

One simulation engine, many views. A **Scenario** (versioned JSON, Pydantic
schema in `engine/fire_engine/scenario.py`) is the unit of work: profile,
accounts, market model, cash-flow rules, events, sim settings. Deterministic
projections are Monte Carlo runs with zero variance.

```
React + TS + Plotly (src/)  ──HTTP──>  FastAPI sidecar (server/)  ──>  fire_engine (pure Python)
        Tauri shell (src-tauri/) spawns the sidecar and injects the port
```

## Engine (`engine/fire_engine/`)

- `scenario.py` — Pydantic models, `SCHEMA_VERSION`, `example_scenario()`
- `sampling.py` — AR(1) inflation; parametric IID lognormal; stationary block
  bootstrap over Shiller 1871–2022 joint annual rows; crash overlays.
  `sample_paths()` returns a `MarketPaths` that can be reused across runs
  (retirement sweep, FIRE-number bisection) for variance-free comparisons.
- `accounts.py` — five tax pools, basis tracking, Roth ordering, conversion
  seasoning, pure `plan_withdrawals()` / mutating `apply_plan()`
- `taxes.py` — vectorized brackets, LTCG stacking, FICA, penalties; data-driven
  from `data/tax_data.json`
- `engine.py` — the annual loop; per-year order of operations:
  1. resolve regime (events) → 2. RMD → 3. HSA pays medical →
  4. fixed-point iteration (6×): income → taxes → free cash flow →
     waterfall (positive) / withdrawal policy (negative) → Roth conversion →
  5. apply plan → 6. grow at blended return → record
- `metrics.py` — percentile fans (real+nominal), survival curve, retirement
  sweep, FIRE numbers (25× and MC bisection), Coast FIRE, accessibility
  series, ladder schedule

Everything is vectorized across paths with NumPy: 2,000 paths × 65 years ≈
**185 ms**, which keeps slider-driven recompute interactive.

Validation: 35 pytest cases including hand-computed 2026 tax cases,
closed-form compounding/spend-down, ladder seasoning, RMD math, and a
Trinity-style check (4%/30yr/75-25 → ~94% success on bootstrap).

## Sidecar (`server/`)

FastAPI on localhost (dev default port 8765). Endpoints:

- `POST /simulate` — scenario → fan, success, pools, accessibility, ladder, survival
- `POST /simulate/sweep` — success probability vs retirement age
- `POST /simulate/fire-number` — MC FIRE number bisection
- `GET /defaults` — example scenario with schema version
- `GET/PUT/DELETE /scenarios/{name}`, `GET /scenarios` — JSON files in the app-data dir
- `GET/POST /snapshots` — actual balance history for the Dashboard overlay

Persistence: `%APPDATA%/fire-app/scenarios/*.json` and `snapshots.json`.

## Frontend (`src/`)

React + TypeScript + Zustand + react-plotly.js. Tabs:
Dashboard (current state + actuals vs projection cone), Inputs (profile,
accounts, market, waterfall, policy), Simulate (event timeline, fan chart,
success-vs-retirement-age curve), Freedom (FIRE/Coast metrics, accessibility
stack, ladder), Compare (overlaid scenarios), Settings.

## Data refresh

- `engine/scripts/build_historical.py` rebuilds the Shiller annual CSV.
- `engine/fire_engine/data/{tax_data,limits}.json` must be refreshed each
  November when the IRS announces next year's figures.

## Conda

Project env: `conda activate fire` (Python 3.13; numpy, pandas, fastapi,
uvicorn, pydantic, pytest, httpx). Tests: `python -m pytest engine/tests`.
