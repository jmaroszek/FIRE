# FIRE

A personal financial-independence projection app: Monte Carlo simulation over
your real account structure — taxes, contribution limits, Roth conversion
ladders, Social Security scenarios, life events — with an interface built for
playing with futures, not filling out forms.

**Read [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) before trusting any number.**
Architecture: [docs/DESIGN.md](docs/DESIGN.md).

## Stack

- `engine/` — pure Python simulation library (NumPy, vectorized; 2,000 paths × 65 years ≈ 185 ms)
- `server/` — FastAPI sidecar wrapping the engine
- `src/` — React + TypeScript + Plotly frontend
- `src-tauri/` — Tauri 2 desktop shell

## Setup (once)

```powershell
conda create -n fire python=3.13 numpy pandas
conda activate fire
pip install fastapi "uvicorn[standard]" pydantic pytest httpx
pip install -e engine
npm install
```

## Run (dev)

Two processes:

```powershell
# terminal 1 — engine sidecar
conda activate fire
python server/main.py

# terminal 2 — app (Tauri window)
npm run tauri dev
#   or browser-only: npm run dev  ->  http://localhost:1420
```

## Tests

```powershell
python -m pytest engine/tests server   # 41 tests: tax hand-cases, ladder, RMD,
                                       # Trinity replication, perf budget, API
```

## Annual maintenance

- November: update `engine/fire_engine/data/tax_data.json` and `limits.json`
  with the IRS's new-year figures.
- Occasionally: `python engine/scripts/build_historical.py` to refresh the
  Shiller dataset (currently 1871–2022).

## Packaging (not yet wired)

Release builds need the sidecar bundled: `pyinstaller --onefile server/main.py`,
then register it as a Tauri sidecar binary in `tauri.conf.json` and spawn it
from Rust on startup. Until then, dev mode (two processes) is the workflow.
