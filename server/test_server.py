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


def test_simulate_carries_distribution_metrics(client):
    s = small_scenario(client)
    body = client.post("/simulate", json=s).json()
    n = s["sim"]["n_paths"]
    assert len(body["ending_balance"]["real"]) == n
    assert len(body["ending_balance"]["nominal"]) == n
    assert len(body["spending_distribution"]["total_real"]) == n
    assert len(body["spending_distribution"]["years_in_cut"]) == n
    assert len(body["max_drawdown"]) == n
    assert len(body["sequence_scatter"]["first_window_return"]) == n
    assert len(body["sequence_scatter"]["survived"]) == n
    ci = body["success_ci"]
    assert ci["lo"] <= ci["rate"] <= ci["hi"] and ci["n_paths"] == n
    ar = body["age_at_ruin"]
    assert ar["total_paths"] == n
    assert ar["success_paths"] + sum(ar["counts"]) == n


def test_max_spend_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/max-spend", json={"scenario": s, "n_paths": 200}).json()
    assert body["max_scale"] >= 0.0
    assert body["max_living_annual"] == pytest.approx(body["max_scale"] * body["base_living_annual"])


def test_surface_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/surface", json={
        "scenario": s, "ages": [s["sim"]["start_year"] - s["profile"]["birth_year"] + 5],
        "spending_scales": [0.9, 1.1], "n_paths": 200,
    }).json()
    assert len(body["matrix"]) == 2 and len(body["matrix"][0]) == 1
    assert all(0.0 <= c <= 1.0 for row in body["matrix"] for c in row)


def test_sensitivity_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/sensitivity", json={"scenario": s, "n_paths": 200}).json()
    assert len(body["entries"]) == 7
    swings = [abs(e["high_success"] - e["low_success"]) for e in body["entries"]]
    assert swings == sorted(swings, reverse=True)


def test_stress_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/stress", json={
        "scenario": s, "shock_age": 30, "duration": 3, "n_paths": 200,
    }).json()
    assert body["stressed_success"] <= body["base_success"] + 1e-9


def test_roth_vs_trad_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/roth-vs-trad", json={"scenario": s, "n_paths": 200}).json()
    assert 0.0 <= body["trad"]["success_rate"] <= 1.0
    assert 0.0 <= body["roth"]["success_rate"] <= 1.0
    assert body["tax_diff"] == pytest.approx(
        body["roth"]["lifetime_tax_real"] - body["trad"]["lifetime_tax_real"])


def test_tax_regime_endpoint(client):
    s = small_scenario(client)
    body = client.post("/simulate/tax-regime", json={
        "scenario": s, "sunset_age": 50, "n_paths": 200,
    }).json()
    assert body["stressed_success"] <= body["base_success"] + 1e-9
    assert body["stressed_lifetime_tax_real"] >= body["base_lifetime_tax_real"]


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


def test_categories_defaults_and_roundtrip(client):
    cats = client.get("/categories").json()
    slugs = [c["slug"] for c in cats]
    assert slugs[0] == "home" and "other" in slugs and len(cats) == 13
    assert all(c["essential"] for c in cats if c["slug"] in ("home", "food", "insurance"))
    # reorder + rename survives a round trip; slug is untouched
    cats[0], cats[1] = cats[1], cats[0]
    cats[0]["name"] = "Eats"
    assert client.put("/categories", json=cats).json()["saved"] == 13
    back = client.get("/categories").json()
    assert back[0]["slug"] == "utilities" and back[0]["name"] == "Eats"
    # duplicate slugs rejected
    bad = back + [back[0]]
    assert client.put("/categories", json=bad).status_code == 400


def test_snapshot_v2_spending_and_liabilities(client):
    snap = {
        "date": "2026-06-12",
        "balances": {"taxable": 1000.0},
        "spending": {"home": 16500.0, "food": 7200.0},
        "liabilities": {"Mattress": 4000.0},
    }
    client.post("/snapshots", json=snap)
    back = client.get("/snapshots").json()
    assert back[0]["spending"]["home"] == 16500.0
    assert back[0]["liabilities"]["Mattress"] == 4000.0
    # v1 snapshots (no spending/liabilities) still validate
    client.post("/snapshots", json={"date": "2026-06-13", "balances": {"cash": 5.0}})
    back = client.get("/snapshots").json()
    assert back[1]["spending"] == {} and back[1]["liabilities"] == {}

