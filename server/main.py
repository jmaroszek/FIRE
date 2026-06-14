"""FastAPI sidecar: a thin HTTP wrapper around fire_engine.

Run dev:  python server/main.py            (or: uvicorn server.main:app --port 8765)
The Tauri shell spawns this as a sidecar and injects the port via FIRE_PORT.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from fire_engine import SCHEMA_VERSION, Scenario, example_scenario, run
from fire_engine import metrics as m
from fire_engine.sampling import sample_paths

APP_DATA = Path(os.environ.get("FIRE_DATA_DIR",
                               Path(os.environ.get("APPDATA", Path.home())) / "fire-app"))
SCENARIO_DIR = APP_DATA / "scenarios"
SNAPSHOT_FILE = APP_DATA / "snapshots.json"
WORKSPACE_FILE = APP_DATA / "workspace.json"
CATEGORY_FILE = APP_DATA / "categories.json"

# Spending categories are add-only by policy: slugs are permanent identifiers
# referenced by snapshots forever; display names and order are free to change.
DEFAULT_CATEGORIES = [
    {"slug": "home", "name": "Home", "essential": True},
    {"slug": "utilities", "name": "Utilities", "essential": True},
    {"slug": "food", "name": "Food", "essential": True},
    {"slug": "auto", "name": "Auto", "essential": True},
    {"slug": "insurance", "name": "Insurance", "essential": True},
    {"slug": "health", "name": "Health", "essential": True},
    {"slug": "technology", "name": "Technology", "essential": False},
    {"slug": "entertainment", "name": "Entertainment", "essential": False},
    {"slug": "travel", "name": "Travel", "essential": False},
    {"slug": "self-care", "name": "Self Care", "essential": False},
    {"slug": "fashion", "name": "Fashion", "essential": False},
    {"slug": "gifts", "name": "Gifts", "essential": False},
    {"slug": "other", "name": "Other", "essential": False},
]

app = FastAPI(title="fire-engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://localhost:1430",
                   "http://localhost:5173",
                   "tauri://localhost", "http://tauri.localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]", "", name).strip()
    if not cleaned:
        raise HTTPException(400, "invalid scenario name")
    return cleaned


@app.get("/health")
def health() -> dict:
    return {"ok": True, "schema_version": SCHEMA_VERSION}


@app.get("/defaults")
def defaults() -> Scenario:
    return example_scenario()


@app.post("/simulate")
def simulate(scenario: Scenario) -> dict:
    result = run(scenario)
    summary = m.summarize(result)
    summary["scenario_name"] = scenario.name
    return summary


class SweepRequest(BaseModel):
    scenario: Scenario
    ages: Optional[list[int]] = None
    n_paths: int = 1000


@app.post("/simulate/sweep")
def sweep(req: SweepRequest) -> dict:
    sweep_result = m.retirement_sweep(req.scenario, ages=req.ages, n_paths=req.n_paths)
    threshold = req.scenario.sim.success_threshold
    return {
        "sweep": sweep_result,
        "threshold": threshold,
        "years_to_fi": m.years_to_fi(sweep_result, threshold, req.scenario.start_age),
    }


class FreedomRequest(BaseModel):
    scenario: Scenario
    n_paths: int = 1000


@app.post("/simulate/freedom")
def freedom(req: FreedomRequest) -> dict:
    s = req.scenario
    current_total = sum(a.balance for a in s.accounts)
    fire_simple = m.fire_number_simple(s)
    fire_mc = m.fire_number_mc(s, n_paths=req.n_paths)
    coast = m.coast_fire(s)
    return {
        "current_total": current_total,
        "fire_number_simple": fire_simple,
        "fire_progress_simple": current_total / fire_simple if fire_simple else None,
        "fire_number_mc": fire_mc,
        "fire_progress_mc": current_total / fire_mc if fire_mc else None,
        "success_threshold": s.sim.success_threshold,
        "coast": coast,
        "annual_retirement_expenses": m.annual_retirement_expenses(s, s.retirement_age),
    }


class MaxSpendRequest(BaseModel):
    scenario: Scenario
    n_paths: int = 1000


@app.post("/simulate/max-spend")
def max_spend(req: MaxSpendRequest) -> dict:
    return m.max_sustainable_spend(req.scenario, n_paths=req.n_paths)


class SurfaceRequest(BaseModel):
    scenario: Scenario
    ages: Optional[list[int]] = None
    spending_scales: Optional[list[float]] = None
    n_paths: int = 800


@app.post("/simulate/surface")
def surface(req: SurfaceRequest) -> dict:
    return m.success_surface(req.scenario, ages=req.ages,
                             spending_scales=req.spending_scales, n_paths=req.n_paths)


class SensitivityRequest(BaseModel):
    scenario: Scenario
    n_paths: int = 2000


@app.post("/simulate/sensitivity")
def sensitivity(req: SensitivityRequest) -> dict:
    return m.sensitivity_tornado(req.scenario, n_paths=req.n_paths)


class StressRequest(BaseModel):
    scenario: Scenario
    shock_age: int
    duration: int = 3
    n_paths: int = 2000


@app.post("/simulate/stress")
def stress(req: StressRequest) -> dict:
    return m.income_stress(req.scenario, shock_age=req.shock_age,
                           duration=req.duration, n_paths=req.n_paths)


class TaxRegimeRequest(BaseModel):
    scenario: Scenario
    sunset_age: int
    bracket_rate_mult: float = 1.15
    std_deduction_mult: float = 0.5
    n_paths: int = 2000


@app.post("/simulate/tax-regime")
def tax_regime(req: TaxRegimeRequest) -> dict:
    return m.tax_regime_stress(req.scenario, sunset_age=req.sunset_age,
                               bracket_rate_mult=req.bracket_rate_mult,
                               std_deduction_mult=req.std_deduction_mult,
                               n_paths=req.n_paths)


class RothTradRequest(BaseModel):
    scenario: Scenario
    n_paths: int = 1000


@app.post("/simulate/roth-vs-trad")
def roth_vs_trad(req: RothTradRequest) -> dict:
    return m.roth_vs_trad(req.scenario, n_paths=req.n_paths)


# ---------------------------------------------------------------- workspace
# The working scenario, autosaved on every edit so the app reopens exactly
# where you left off — independent of named "saved scenarios".

@app.get("/workspace")
def get_workspace() -> Scenario:
    if not WORKSPACE_FILE.exists():
        raise HTTPException(404, "no workspace yet")
    raw = json.loads(WORKSPACE_FILE.read_text())
    if raw.get("schema_version", 0) > SCHEMA_VERSION:
        raise HTTPException(409, "workspace was saved by a newer app version")
    return Scenario.model_validate(raw)


@app.put("/workspace")
def save_workspace(scenario: Scenario) -> dict:
    APP_DATA.mkdir(parents=True, exist_ok=True)
    WORKSPACE_FILE.write_text(scenario.model_dump_json(indent=2))
    return {"saved": True}


# ---------------------------------------------------------------- scenarios

@app.get("/scenarios")
def list_scenarios() -> list[dict]:
    SCENARIO_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for f in sorted(SCENARIO_DIR.glob("*.json")):
        try:
            raw = json.loads(f.read_text())
            out.append({"name": raw.get("name", f.stem),
                        "schema_version": raw.get("schema_version")})
        except (json.JSONDecodeError, OSError):
            continue
    return out


@app.get("/scenarios/{name}")
def get_scenario(name: str) -> Scenario:
    path = SCENARIO_DIR / f"{_safe_name(name)}.json"
    if not path.exists():
        raise HTTPException(404, f"scenario {name!r} not found")
    raw = json.loads(path.read_text())
    if raw.get("schema_version", 0) > SCHEMA_VERSION:
        raise HTTPException(409, "scenario was saved by a newer app version")
    return Scenario.model_validate(raw)


@app.put("/scenarios/{name}")
def save_scenario(name: str, scenario: Scenario) -> dict:
    SCENARIO_DIR.mkdir(parents=True, exist_ok=True)
    scenario.name = _safe_name(name)
    path = SCENARIO_DIR / f"{scenario.name}.json"
    path.write_text(scenario.model_dump_json(indent=2))
    return {"saved": scenario.name}


@app.delete("/scenarios/{name}")
def delete_scenario(name: str) -> dict:
    path = SCENARIO_DIR / f"{_safe_name(name)}.json"
    if not path.exists():
        raise HTTPException(404, f"scenario {name!r} not found")
    path.unlink()
    return {"deleted": name}


# ---------------------------------------------------------------- categories

class Category(BaseModel):
    slug: str  # permanent identifier; never rename or reuse
    name: str  # display name, freely editable
    essential: bool = False


@app.get("/categories")
def get_categories() -> list[Category]:
    if CATEGORY_FILE.exists():
        return [Category.model_validate(c) for c in json.loads(CATEGORY_FILE.read_text())]
    return [Category.model_validate(c) for c in DEFAULT_CATEGORIES]


@app.put("/categories")
def save_categories(categories: list[Category]) -> dict:
    slugs = [c.slug for c in categories]
    if len(set(slugs)) != len(slugs):
        raise HTTPException(400, "duplicate category slugs")
    APP_DATA.mkdir(parents=True, exist_ok=True)
    CATEGORY_FILE.write_text(json.dumps([c.model_dump() for c in categories], indent=2))
    return {"saved": len(categories)}


# ---------------------------------------------------------------- snapshots

class Snapshot(BaseModel):
    date: date
    balances: dict[str, float] = Field(default_factory=dict)  # pool -> amount
    # annual spending by category slug, nominal dollars at the snapshot date
    spending: dict[str, float] = Field(default_factory=dict)
    # outstanding loan balances by liability name
    liabilities: dict[str, float] = Field(default_factory=dict)
    note: str = ""


def _load_snapshots() -> list[dict]:
    if SNAPSHOT_FILE.exists():
        return json.loads(SNAPSHOT_FILE.read_text())
    return []


@app.get("/snapshots")
def get_snapshots() -> list[dict]:
    return _load_snapshots()


@app.post("/snapshots")
def add_snapshot(snap: Snapshot) -> dict:
    APP_DATA.mkdir(parents=True, exist_ok=True)
    snaps = [s for s in _load_snapshots() if s["date"] != snap.date.isoformat()]
    snaps.append(json.loads(snap.model_dump_json()))
    snaps.sort(key=lambda s: s["date"])
    SNAPSHOT_FILE.write_text(json.dumps(snaps, indent=2))
    return {"count": len(snaps)}


@app.delete("/snapshots/{snap_date}")
def delete_snapshot(snap_date: str) -> dict:
    snaps = [s for s in _load_snapshots() if s["date"] != snap_date]
    SNAPSHOT_FILE.write_text(json.dumps(snaps, indent=2))
    return {"count": len(snaps)}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("FIRE_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port)
