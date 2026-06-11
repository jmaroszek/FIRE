"""API tests against the FastAPI TestClient (uses a temp data dir)."""

import importlib
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FIRE_DATA_DIR", str(tmp_path))
    import main as server_main
    importlib.reload(server_main)
    return TestClient(server_main.app)


def small_scenario(client) -> dict:
    s = client.get("/defaults").json()
    s["sim"]["n_paths"] = 200
    return s


def test_health(client):
    body = client.get("/health").json()
    assert body["ok"] and body["schema_version"] >= 1


def test_simulate_returns_fan_and_metrics(client):
    s = small_scenario(client)
    body = client.post("/simulate", json=s).json()
    assert 0.0 <= body["success_rate"] <= 1.0
    fan = body["fan"]
    n_points = len(fan["real"]["p50"])
    assert n_points == len(body["ages"]) + 1
    # percentile ordering
    assert all(a <= b for a, b in zip(fan["real"]["p25"], fan["real"]["p75"]))
    assert body["ladder_schedule"]  # example scenario has a ladder
    assert "roth_matured_conversions" in body["accessibility_real"]


def test_sweep_monotone_ish(client):
    s = small_scenario(client)
    resp = client.post("/simulate/sweep",
                       json={"scenario": s, "ages": [40, 50, 60], "n_paths": 200}).json()
    sweep = {int(k): v for k, v in resp["sweep"].items()}
    assert sweep[60] >= sweep[40]  # retiring later can't hurt


def test_freedom_metrics(client):
    s = small_scenario(client)
    body = client.post("/simulate/freedom", json={"scenario": s, "n_paths": 200}).json()
    assert body["fire_number_simple"] == pytest.approx(25 * body["annual_retirement_expenses"])
    assert body["fire_number_mc"] is None or body["fire_number_mc"] > 0
    assert body["coast"]["coast_number"] > 0


def test_scenario_crud(client):
    s = small_scenario(client)
    assert client.get("/scenarios").json() == []
    client.put("/scenarios/My Plan", json=s)
    names = [x["name"] for x in client.get("/scenarios").json()]
    assert names == ["My Plan"]
    loaded = client.get("/scenarios/My Plan").json()
    assert loaded["sim"]["n_paths"] == 200
    assert client.delete("/scenarios/My Plan").json()["deleted"] == "My Plan"
    assert client.get("/scenarios/My Plan").status_code == 404


def test_snapshots_upsert_by_date(client):
    client.post("/snapshots", json={"date": "2026-06-11", "balances": {"taxable": 30000}})
    client.post("/snapshots", json={"date": "2026-06-11", "balances": {"taxable": 31000}})
    snaps = client.get("/snapshots").json()
    assert len(snaps) == 1
    assert snaps[0]["balances"]["taxable"] == 31000
