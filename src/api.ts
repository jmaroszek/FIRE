import type {
  BridgeCrashResult, Category, FreedomResult, LadderSavingsResult, MaxSpendResult,
  Scenario, SensitivityResult, SimulateResult, Snapshot, StressEarliestResult, StressResult,
  SurfaceResult, SweepResult, TaxRegimeResult,
} from "./types";
import { getCached, putCached } from "./simCache";

// Tauri injects the sidecar port on `window`; fall back to the dev default.
// Guard `window` so this module is importable outside the browser (e.g. tests).
const FIRE_PORT = typeof window !== "undefined" ? (window as any).__FIRE_PORT__ : undefined;
const BASE = `http://127.0.0.1:${FIRE_PORT ?? 8765}`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status} ${path}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

// The engine is seeded, so each analysis below is a pure function of its request
// body — wrap them so a repeat call (e.g. reopening an unchanged profile) is
// served from localStorage instead of recomputing the Monte Carlo. `body` is the
// exact JSON sent to the server, so it doubles as the cache key. Storage-backed
// endpoints (workspace/scenarios/snapshots/categories) are intentionally NOT
// cached — they mutate.
async function cachedPost<T>(tag: string, path: string, body: unknown): Promise<T> {
  const hit = getCached<T>(tag, body);
  if (hit !== null) return hit;
  const value = await req<T>(path, { method: "POST", body: JSON.stringify(body) });
  putCached(tag, body, value);
  return value;
}

export const api = {
  health: () => req<{ ok: boolean; schema_version: number }>("/health"),
  defaults: () => req<Scenario>("/defaults"),
  simulate: (scenario: Scenario) =>
    cachedPost<SimulateResult>("simulate", "/simulate", scenario),
  // Success-probability analyses default to the scenario's own path count so they
  // sample the SAME seeded paths as the main /simulate run — every success number
  // on the Freedom tab then agrees exactly (no 800-vs-2000 sampling-noise gaps).
  sweep: (scenario: Scenario, nPaths = scenario.sim.n_paths) =>
    cachedPost<SweepResult>("sweep", "/simulate/sweep", { scenario, n_paths: nPaths }),
  freedom: (scenario: Scenario, nPaths = 800) =>
    cachedPost<FreedomResult>("freedom", "/simulate/freedom", { scenario, n_paths: nPaths }),
  maxSpend: (scenario: Scenario, nPaths = 1000) =>
    cachedPost<MaxSpendResult>("max-spend", "/simulate/max-spend", { scenario, n_paths: nPaths }),
  surface: (scenario: Scenario, nPaths = scenario.sim.n_paths) =>
    cachedPost<SurfaceResult>("surface", "/simulate/surface", { scenario, n_paths: nPaths }),
  sensitivity: (scenario: Scenario, nPaths = scenario.sim.n_paths) =>
    cachedPost<SensitivityResult>("sensitivity", "/simulate/sensitivity",
      { scenario, n_paths: nPaths }),
  stress: (scenario: Scenario, shockAge: number, duration = 1, nPaths = 2000) =>
    cachedPost<StressResult>("stress", "/simulate/stress",
      { scenario, shock_age: shockAge, duration, n_paths: nPaths }),
  stressEarliest: (scenario: Scenario, shockAge: number, duration = 1, nPaths = 800) =>
    cachedPost<StressEarliestResult>("stress-earliest", "/simulate/stress-earliest",
      { scenario, shock_age: shockAge, duration, n_paths: nPaths }),
  ladderSavings: (scenario: Scenario, nPaths = 1000) =>
    cachedPost<LadderSavingsResult>("ladder-savings", "/simulate/ladder-savings",
      { scenario, n_paths: nPaths }),
  bridgeCrash: (scenario: Scenario, drop = 0.3, years = 2, nPaths = 2000) =>
    cachedPost<BridgeCrashResult>("bridge-crash", "/simulate/bridge-crash",
      { scenario, drop, years, n_paths: nPaths }),
  taxRegime: (scenario: Scenario, sunsetAge: number,
              bracketRateMult = 1.15, stdDeductionMult = 0.5, nPaths = 2000) =>
    cachedPost<TaxRegimeResult>("tax-regime", "/simulate/tax-regime", {
      scenario, sunset_age: sunsetAge, bracket_rate_mult: bracketRateMult,
      std_deduction_mult: stdDeductionMult, n_paths: nPaths,
    }),
  getWorkspace: () => req<Scenario>("/workspace"),
  saveWorkspace: (scenario: Scenario) =>
    req<{ saved: boolean }>("/workspace", { method: "PUT", body: JSON.stringify(scenario) }),
  // Best-effort save that survives a page teardown (tab close, dev hot-reload).
  // `keepalive` lets the PUT outlive the document; fire-and-forget, no await.
  saveWorkspaceSync: (scenario: Scenario) => {
    try {
      void fetch(`${BASE}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
        keepalive: true,
      });
    } catch {
      /* nothing else we can do during teardown */
    }
  },
  listScenarios: () => req<{ name: string }[]>("/scenarios"),
  loadScenario: (name: string) => req<Scenario>(`/scenarios/${encodeURIComponent(name)}`),
  saveScenario: (name: string, scenario: Scenario) =>
    req<{ saved: string }>(`/scenarios/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(scenario),
    }),
  deleteScenario: (name: string) =>
    req<{ deleted: string }>(`/scenarios/${encodeURIComponent(name)}`, { method: "DELETE" }),
  categories: () => req<Category[]>("/categories"),
  saveCategories: (categories: Category[]) =>
    req<{ saved: number }>("/categories", { method: "PUT", body: JSON.stringify(categories) }),
  snapshots: () => req<Snapshot[]>("/snapshots"),
  addSnapshot: (snap: Snapshot) =>
    req<{ count: number }>("/snapshots", { method: "POST", body: JSON.stringify(snap) }),
  deleteSnapshot: (date: string) =>
    req<{ count: number }>(`/snapshots/${date}`, { method: "DELETE" }),
};
