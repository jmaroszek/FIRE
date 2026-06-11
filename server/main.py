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

app = FastAPI(title="fire-engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://localhost:5173",
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


# ---------------------------------------------------------------- snapshots

class Snapshot(BaseModel):
    date: date
    balances: dict[str, float] = Field(default_factory=dict)  # pool -> amount
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
