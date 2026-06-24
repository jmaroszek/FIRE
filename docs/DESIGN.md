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
  1. resolve regime (events) + the active allocation (base, glidepath, or event
     override) → 2. RMD → 3. HSA pays medical →
  4. fixed-point iteration (6×): income → taxes → free cash flow →
     waterfall (positive) / withdrawal policy (negative; in `bracket_filled`
     mode the 59½+ traditional+HSA draw is capped to a target bracket, spilling
     to Roth) → Roth conversion (fills the room the spending draw leaves) →
     ACA/IRMAA feedback (MAGI → subsidy/surcharge → cash flow) →
  5. apply plan → 6. grow at the allocation-blended return → record
- `metrics.py` — percentile fans (real+nominal), survival curve, retirement
  sweep, FIRE numbers (25× and MC bisection), Coast FIRE, accessibility
  series, ladder schedule, healthcare medians, sensitivity tornado

Everything is vectorized across paths with NumPy: 2,000 paths × 65 years ≈
**185 ms**, which keeps slider-driven recompute interactive.

Validation: **130** pytest cases including hand-computed 2026 tax cases,
closed-form compounding/spend-down, ladder seasoning, RMD math, the
contribution-waterfall and allocation-glidepath schedules, and a Trinity-style
check (4%/30yr/75-25 → ~94% success on bootstrap).

### Schema versioning

`SCHEMA_VERSION` (currently **6**) tags every saved Scenario. New optional
fields default empty, so older scenarios load unchanged — the sidecar only
rejects a file whose version is *newer* than it understands. History:
- v2: `income_streams`, `waterfall_schedule`, `medical_streams`, `Liability.start_age`
- v3: `allocation_schedule` (age-keyed allocation glidepath, mirroring `waterfall_schedule`)
- v5: spending strategy consolidated to `constant_dollar` + `percent_portfolio`
- v6: tax-aware withdrawal policy (`mode`, `bracket_top`, `custom_top` on `WithdrawalPolicy`)

The TypeScript types in `src/types.ts` mirror this schema and must be kept in sync.

## Sidecar (`server/`)

FastAPI on localhost (dev default port 8765). Endpoints:

- `POST /simulate` — scenario → fan, success, pools, accessibility, bridge,
  ladder, RMDs, survival, drawdown, ending-balance & failure distributions,
  healthcare (net cost + ACA subsidy), tax-rate series
- `POST /simulate/sweep` — success probability + die-with-zero estate vs retirement age
- `POST /simulate/freedom` — FIRE numbers (25× + MC), Coast FIRE, progress
- `POST /simulate/max-spend` — max sustainable spending (MC bisection)
- `POST /simulate/surface` — success across retirement-age × spending-level
- `POST /simulate/sensitivity` — one-at-a-time tornado
- `POST /simulate/stress` — income-shock (wages zeroed for a window)
- `POST /simulate/roth-vs-trad` — contribution-routing comparison
- `POST /simulate/bridge-crash` — retire-into-a-crash sequence stress
- `POST /simulate/tax-regime` — TCJA-sunset reversion stress
- `GET /defaults` · `GET/PUT /workspace` · `GET/PUT/DELETE /scenarios/{name}` · `GET /scenarios`
- `GET/PUT /categories` · `GET/POST/DELETE /snapshots` — recorded actuals

Persistence: `%APPDATA%/fire-app/` — `workspace.json` (the live autosaved
scenario), `scenarios/*.json` (named saves), `snapshots.json`, `categories.json`.

## Frontend (`src/`)

React + TypeScript + Zustand + react-plotly.js. A **collapsible grouped left
sidebar** (`App.tsx`) navigates the planning journey; the content column carries
a slim top bar (the real/nominal & age/year display lenses + the scenario
switcher/Save). One Zustand store (`store.ts`) holds the scenario and all
on-demand analysis bundles; edits debounce-resimulate (250 ms) and autosave to
the workspace (800 ms).

Tabs, organized around the question each answers (`src/tabs/`):

- **Assumptions** — the exogenous backdrop you can't control: market model,
  inflation, profile, sim settings, plus a read-only **Assumptions Summary**
  (the audit surface — every input in one place regardless of where it's edited).
- **Cash Flow** — what flows in and out across life: income + streams, Social
  Security, expenses, medical, ACA premium, spending strategy, life-events
  timeline, income-shock stress; retirement-spending / realized-spending /
  fulfillment / healthcare-cost / lifestyle-creep charts; max sustainable spend.
- **Accounts** — assets, structure, and access, in four sections (Today /
  Growth / Liquidity & Drawdown / History): balances, debt, contributions,
  withdrawal policy, allocation + glidepath, the Roth conversion ladder;
  wealth-&-flows, drawdown, liquidity, bridge, subsidy-vs-conversion charts;
  snapshot recorder + net-worth history.
- **Taxes** — the consequence scoreboard: taxes-over-time (marginal/effective),
  Roth-vs-Traditional, lifetime tax, RMDs, traditional over-funding, TCJA-sunset
  stress, IRMAA.
- **Freedom** — the retirement decision, in three sections (Overall Success /
  Undersaving / Oversaving): success + CI, FIRE/Coast, the when-can-I-retire
  sweep, success surface, sensitivity tornado; survival, ruin, failure severity;
  over-saving frontier, headroom, ending-net-worth distribution.
- **Compare** — overlaid saved scenarios. **Settings** — spending categories + about.

**Input model.** Inputs are *edited in context* on the tab whose charts they
drive (income on Cash Flow, the ladder on Accounts, state tax on Taxes), while
cross-cutting engine assumptions and scaffolding live on Assumptions. Because
it's one Zustand scenario object, every edit — wherever it's made — flows through
the same save/dirty/Compare model. Deep tabs (Accounts, Freedom) carry a sticky
in-page `SectionNav` for wayfinding. What-if knobs (stress sizes, go-go age) sit
beside their chart and may be local UI state rather than saved scenario fields.

## Data refresh

- `engine/scripts/build_historical.py` rebuilds the Shiller annual CSV.
- `engine/fire_engine/data/{tax_data,limits}.json` must be refreshed each
  November when the IRS announces next year's figures.

## Conda

Project env: `conda activate fire` (Python 3.13; numpy, pandas, fastapi,
uvicorn, pydantic, pytest, httpx). Tests: `python -m pytest engine/tests`.
