import type {
  BridgeCrashResult, Category, FreedomResult, MaxSpendResult, RothTradResult, Scenario,
  SensitivityResult, SimulateResult, Snapshot, StressResult, SurfaceResult, SweepResult,
  TaxRegimeResult,
} from "./types";

const BASE = `http://127.0.0.1:${(window as any).__FIRE_PORT__ ?? 8765}`;

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

export const api = {
  health: () => req<{ ok: boolean; schema_version: number }>("/health"),
  defaults: () => req<Scenario>("/defaults"),
  simulate: (scenario: Scenario) =>
    req<SimulateResult>("/simulate", { method: "POST", body: JSON.stringify(scenario) }),
  sweep: (scenario: Scenario, nPaths = 800) =>
    req<SweepResult>("/simulate/sweep", {
      method: "POST",
      body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  freedom: (scenario: Scenario, nPaths = 800) =>
    req<FreedomResult>("/simulate/freedom", {
      method: "POST",
      body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  maxSpend: (scenario: Scenario, nPaths = 1000) =>
    req<MaxSpendResult>("/simulate/max-spend", {
      method: "POST", body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  surface: (scenario: Scenario, nPaths = 800) =>
    req<SurfaceResult>("/simulate/surface", {
      method: "POST", body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  sensitivity: (scenario: Scenario, nPaths = 2000) =>
    req<SensitivityResult>("/simulate/sensitivity", {
      method: "POST", body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  stress: (scenario: Scenario, shockAge: number, duration = 3, nPaths = 2000) =>
    req<StressResult>("/simulate/stress", {
      method: "POST",
      body: JSON.stringify({ scenario, shock_age: shockAge, duration, n_paths: nPaths }),
    }),
  rothVsTrad: (scenario: Scenario, nPaths = 1000) =>
    req<RothTradResult>("/simulate/roth-vs-trad", {
      method: "POST", body: JSON.stringify({ scenario, n_paths: nPaths }),
    }),
  bridgeCrash: (scenario: Scenario, drop = 0.3, years = 2, nPaths = 2000) =>
    req<BridgeCrashResult>("/simulate/bridge-crash", {
      method: "POST",
      body: JSON.stringify({ scenario, drop, years, n_paths: nPaths }),
    }),
  taxRegime: (scenario: Scenario, sunsetAge: number,
              bracketRateMult = 1.15, stdDeductionMult = 0.5, nPaths = 2000) =>
    req<TaxRegimeResult>("/simulate/tax-regime", {
      method: "POST",
      body: JSON.stringify({
        scenario, sunset_age: sunsetAge, bracket_rate_mult: bracketRateMult,
        std_deduction_mult: stdDeductionMult, n_paths: nPaths,
      }),
    }),
  getWorkspace: () => req<Scenario>("/workspace"),
  saveWorkspace: (scenario: Scenario) =>
    req<{ saved: boolean }>("/workspace", { method: "PUT", body: JSON.stringify(scenario) }),
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
