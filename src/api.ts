import type {
  FreedomResult, Scenario, SimulateResult, Snapshot, SweepResult,
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
  snapshots: () => req<Snapshot[]>("/snapshots"),
  addSnapshot: (snap: Snapshot) =>
    req<{ count: number }>("/snapshots", { method: "POST", body: JSON.stringify(snap) }),
  deleteSnapshot: (date: string) =>
    req<{ count: number }>(`/snapshots/${date}`, { method: "DELETE" }),
};
