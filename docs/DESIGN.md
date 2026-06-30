# FIRE App — Architecture

One simulation engine, many views. A **Scenario** (versioned JSON, Pydantic
schema in `engine/fire_engine/scenario/`) is the unit of work: profile, accounts,
market model, cash-flow rules, events, sim settings. Deterministic projections
are Monte Carlo runs with a fixed seed, so the same scenario always yields the
same numbers.

```
React + TS + Plotly (src/)  ──HTTP──>  FastAPI sidecar (server/)  ──>  fire_engine (pure Python)
        Tauri shell (src-tauri/) spawns the sidecar and injects the port
```

The codebase is organized so each concept has **one home**: shared constants,
formatters, and the color/label system are defined once and imported everywhere
(see the [June 2026 cohesion refactor](#code-organization)).

## Engine (`engine/fire_engine/`)

- `scenario/` — Pydantic models split by concern (enums, market, income,
  expenses, spending, health, events, core), re-exported from the package root;
  holds `SCHEMA_VERSION`, `example_scenario()`, and `validate_invariants()`
- `constants.py` — domain constants in one place: penalty-free ages, RMD start
  age, conversion seasoning years, the 25× FIRE multiple
- `sampling.py` — AR(1) inflation; parametric IID lognormal; stationary block
  bootstrap over Shiller 1871–2022 joint annual rows; crash overlays.
  `sample_paths()` returns a `MarketPaths` reusable across runs (retirement
  sweep, FIRE-number bisection) for variance-free comparisons
- `accounts.py` — five tax pools, basis tracking, Roth ordering, conversion
  seasoning; pure `plan_withdrawals()` / mutating `apply_plan()`
- `taxes.py` — vectorized brackets, LTCG stacking, FICA, penalties, the SS
  provisional-income test, and `income_tax()` (the whole year's tax, decomposed)
  — data-driven from `data/tax_data.json`
- `engine.py` — the annual loop; per-year order of operations:
  1. validate invariants → resolve regime (events) + active allocation (base,
     glidepath, or event override) → 2. RMD → 3. HSA pays medical →
  4. **fixed-point iteration** (up to 6×, breaks early on convergence):
     income → taxes → free cash flow → waterfall (positive) / withdrawal policy
     (negative; `bracket_filled` mode caps the 59½+ traditional+HSA draw to a
     target bracket, spilling to Roth) → Roth conversion → ACA/IRMAA feedback
     (MAGI → subsidy/surcharge → cash flow) →
  5. apply plan → 6. grow at the allocation-blended return → record
- `metrics/` — results, split by concern (timeseries, success, bridge,
  distributions, surfaces, stress, summary) re-exported from the package root:
  percentile fans (real+nominal), survival curve, retirement sweep, FIRE numbers
  (25× and MC bisection), Coast FIRE, accessibility series, ladder schedule,
  healthcare medians, sensitivity tornado

Everything is vectorized across paths with NumPy: 2,000 paths × 65 years ≈
**185 ms** on a modern laptop, which keeps slider-driven recompute interactive. The fixed-point
loop breaks as soon as the carried state stops changing, rather than always
running the full iteration count.

### Validation

`validate_invariants(scenario)` returns the hard, engine-breaking input errors
(non-positive horizon, off-100% allocation, non-positive path count); `run()`
raises `ValueError` on any, and the server turns that into a clean `400`. The
frontend mirrors and extends these checks in `src/validate.ts` as advisory
warnings (see [Frontend](#frontend-src)).

### Schema versioning

`SCHEMA_VERSION` (currently **8**) tags every saved Scenario. New optional fields
default empty, so older scenarios load unchanged — the sidecar only rejects a
file whose version is *newer* than it understands. History:
- v2: `income_streams`, `waterfall_schedule`, `medical_streams`, `Liability.start_age`
- v3: `allocation_schedule` (age-keyed allocation glidepath)
- v5: spending strategy consolidated to `constant_dollar` + `percent_portfolio`
- v6: tax-aware withdrawal policy (`mode`, `bracket_top`, `custom_top`)
- v7: first-class `housing` config
- v8: ACA `coverage_start_age`

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
- `POST /simulate/stress` · `POST /simulate/stress-earliest` — income-shock
  (wages zeroed for a window) and the earliest safe age under that shock
- `POST /simulate/bridge-crash` — retire-into-a-crash sequence stress
- `POST /simulate/tax-regime` — TCJA-sunset reversion stress
- `POST /simulate/ladder-savings` — lifetime-tax saved by the conversion ladder
- `GET /defaults` · `GET/PUT /workspace` · `GET/PUT/DELETE /scenarios/{name}` · `GET /scenarios`
- `GET/PUT /categories` · `GET/POST/DELETE /snapshots` — recorded actuals

A scenario the engine rejects returns `400` (via a `ValueError` handler) rather
than an opaque `500`.

Persistence: `%APPDATA%/fire-app/` — `workspace.json` (the live autosaved
scenario), `scenarios/*.json` (named saves), `snapshots.json`, `categories.json`.

## Frontend (`src/`)

React + TypeScript + Zustand + react-plotly.js. A collapsible grouped left
sidebar (`App.tsx`) navigates the planning journey; the content column carries a
slim top bar (the age/year display lens + the scenario switcher/Save) and a
non-blocking validation banner. One Zustand store (`store.ts`) holds the scenario
and all on-demand analysis bundles; edits debounce-resimulate (250 ms) and
autosave to the workspace (500 ms). Every tab subscribes through
`useStore(useShallow(...))` selectors so a change to one slice doesn't re-render
unrelated tabs, and all chart components are wrapped in `React.memo`.

Shared modules (one home per concept):
- `format.ts` — currency/percent formatting
- `math.ts` — median, percentile, niceStep, percentileAt
- `constants.ts` — age thresholds
- `labels.ts` — the canonical source/pool labels (Title Case + age annotations)
- `validate.ts` — scenario validation (errors + warnings) shown in the banner
- `components/chartShared.tsx` — the Plotly wrapper (a ResizeObserver that
  resizes charts to their container), dark theme, the semantic color system,
  axis/format helpers, and life-stage markers
- `components/charts/` — chart components split by domain (series, networth,
  accessibility, spending, risk, taxes, compare) behind a barrel `index.ts`

Tabs, organized around the question each answers (`src/tabs/`):

- **Assumptions** — the exogenous backdrop you can't control (market, inflation,
  profile, sim settings) plus a read-only **Assumptions Summary** audit surface.
- **Cash Flow** — income + streams, Social Security, expenses, spending strategy,
  the life-events timeline, income-shock stress; spending / fulfillment /
  lifestyle-creep charts; max sustainable spend.
- **Accounts** — balances, debt, contributions, withdrawal policy, allocation +
  glidepath, the Roth conversion ladder; wealth-&-flows, drawdown, liquidity,
  bridge, subsidy-vs-conversion charts; snapshot recorder + net-worth history.
- **Healthcare** — HSA-eligible medical spending, ACA premiums/subsidy, IRMAA,
  long-term care, and the net healthcare trajectory.
- **Taxes** — taxes-over-time (marginal/effective), Roth-vs-Traditional, lifetime
  tax, RMDs, traditional over-funding, TCJA-sunset stress.
- **Freedom** — success + CI, FIRE/Coast, the when-can-I-retire sweep, success
  surface, sensitivity tornado; survival, ruin, failure severity; over-saving
  frontier, headroom, ending-net-worth distribution.
- **Compare** — overlaid saved scenarios. **Settings** — spending categories.

**Input model.** Inputs are *edited in context* on the tab whose charts they
drive, while cross-cutting engine assumptions live on Assumptions. Because it's
one Zustand scenario object, every edit flows through the same save/dirty/Compare
model. What-if knobs (stress sizes, go-go age) may be local UI state rather than
saved scenario fields.

## Testing

- **Python — 200+ tests** (`engine/tests/` + `server/`): hand-computed 2026 tax
  cases, closed-form compounding/spend-down, ladder seasoning, RMD math, the
  contribution-waterfall and allocation-glidepath schedules, conservation
  invariants, ACA/IRMAA, LTC, spending strategies, the SS-torpedo `income_tax()`,
  scenario validation, a Trinity-style replication (4%/30yr/75-25 → ~94% success
  on bootstrap), and the API surface. Run: `python -m pytest engine/tests server`.
- **TypeScript — 33 tests** (vitest): the pure frontend logic that feeds
  displayed numbers — `math.ts`, `format.ts`, `validate.ts`, and the store
  helpers. Run: `npm test`.

## Code organization

A June 2026 cohesion refactor unified the project after feature-by-feature
growth: shared frontend modules (`format`/`math`/`constants`/`labels`/
`chartShared`), per-domain chart files, engine `constants.py` and a centralized
`income_tax()`, the `metrics/` and `scenario/` package splits, and the
fixed-point early-break. Public import surfaces are preserved via package
re-exports, so the splits changed file layout without changing any caller.

## Data refresh

- `engine/scripts/build_historical.py` rebuilds the Shiller annual CSV.
- `engine/fire_engine/data/{tax_data,limits}.json` must be refreshed each
  November when the IRS announces next year's figures.

## Conda

Project env: `conda activate fire` (Python 3.13; numpy, pandas, fastapi,
uvicorn, pydantic, pytest, httpx).
