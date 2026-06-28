import { create } from "zustand";
import { api } from "./api";
import { COMPARE_PALETTE } from "./constants";
import { getCached, setCacheSchemaVersion } from "./simCache";
import type {
  BridgeCrashResult, Category, FreedomResult, LadderSavingsResult, MaxSpendResult,
  Scenario, SensitivityResult, SimulateResult, Snapshot, StressResult,
  SurfaceResult, SweepResult, TaxRegimeResult,
} from "./types";
import { DEFAULT_HOUSING } from "./types";

export type Tab =
  | "assumptions" | "cashflow" | "accounts" | "housing" | "taxes" | "freedom"
  | "compare" | "settings";

/** Every living expense is subject to inflation — the per-stream Inflates / CPI+
 * controls were removed from the UI, so we enforce the invariant here at the single
 * chokepoint where any scenario enters state (fresh, loaded, or edited). This keeps
 * old saved scenarios and engine requests consistent without surfacing the fields.
 * (Medical streams keep their own CPI+ control, so they're left untouched.) */
export function normalizeScenario(s: Scenario): Scenario {
  const expensesOk = !s.expense_streams?.some((e) => !e.inflates || e.extra_inflation);
  const housingOk = s.housing != null;  // backfill so older saves load with a config
  if (expensesOk && housingOk) return s;
  return {
    ...s,
    expense_streams: expensesOk ? s.expense_streams : s.expense_streams.map((e) =>
      e.inflates && !e.extra_inflation ? e : { ...e, inflates: true, extra_inflation: 0 }),
    housing: s.housing ?? DEFAULT_HOUSING,
  };
}

/** In estimated-SS mode, fold any snapshots that recorded covered earnings into
 * social_security.recorded_earnings (age -> today's $). Done at request time so
 * the stored scenario stays clean and the map can't go stale against snapshots.
 * Past nominal earnings are grown to today's dollars by the assumed mean inflation,
 * mirroring the Lifestyle Creep chart's deflation. */
function withRecordedEarnings(s: Scenario, snapshots: Snapshot[]): Scenario {
  if (s.social_security?.benefit_mode !== "estimated") return s;
  const nowYear = new Date().getFullYear();
  const infl = s.inflation.mean;
  const recorded: Record<number, number> = {};
  for (const snap of snapshots) {
    if (!snap.earnings || snap.earnings <= 0) continue;
    const snapYear = new Date(snap.date).getFullYear();
    const age = snapYear - s.profile.birth_year;
    recorded[age] = snap.earnings * Math.pow(1 + infl, nowYear - snapYear);
  }
  return { ...s, social_security: { ...s.social_security, recorded_earnings: recorded } };
}

export interface CompareSlot {
  /** Stable identity, independent of the display name, so renaming a pin can't
   *  break removal or the async sweep that resolves back into its slot. */
  id: string;
  name: string;
  /** Line color, bound at pin time and kept for the slot's life (see COMPARE_PALETTE). */
  color: string;
  scenario: Scenario;
  result: SimulateResult;
  sweep: SweepResult | null;
  sweepPending?: boolean;
  /** Monte Carlo FIRE number (portfolio needed to clear the success threshold);
   *  fetched from the freedom endpoint in the background after the slot is pinned. */
  mcNumber?: number | null;
  mcPending?: boolean;
}

interface AppState {
  tab: Tab;
  scenario: Scenario | null;
  /** name the scenario was last saved under, "" = never saved */
  savedAs: string;
  dirty: boolean;
  result: SimulateResult | null;
  simulating: boolean;
  simError: string | null;
  sweep: SweepResult | null;
  sweeping: boolean;
  freedom: FreedomResult | null;
  freedomLoading: boolean;
  // on-demand decision-surface analyses (Phase 2); all nulled on every simulate
  maxspend: MaxSpendResult | null;
  maxspendLoading: boolean;
  surface: SurfaceResult | null;
  surfaceLoading: boolean;
  sensitivity: SensitivityResult | null;
  sensitivityLoading: boolean;
  stress: StressResult | null;
  stressLoading: boolean;
  taxregime: TaxRegimeResult | null;
  taxregimeLoading: boolean;
  laddersavings: LadderSavingsResult | null;
  laddersavingsLoading: boolean;
  bridgecrash: BridgeCrashResult | null;
  bridgecrashLoading: boolean;
  savedScenarios: string[];
  compare: CompareSlot[];
  snapshots: Snapshot[];
  categories: Category[];
  axisMode: "age" | "year";
  sidebarCollapsed: boolean;
  engineUp: boolean | null;

  setTab: (t: Tab) => void;
  setSidebarCollapsed: (v: boolean) => void;
  init: () => Promise<void>;
  setScenario: (s: Scenario) => void;
  patchScenario: (patch: Partial<Scenario>) => void;
  /** Immediately write any pending workspace edit. Call on tab-hide / app-close.
   *  `sync` uses a keepalive request that survives a page teardown. */
  flushWorkspace: (sync?: boolean) => void;
  runSweep: () => Promise<void>;
  runFreedom: () => Promise<void>;
  runMaxSpend: () => Promise<void>;
  runSurface: () => Promise<void>;
  runSensitivity: () => Promise<void>;
  runStress: (shockAge: number, duration: number) => Promise<void>;
  runTaxRegime: (sunsetAge: number) => Promise<void>;
  runLadderSavings: () => Promise<void>;
  runBridgeCrash: (drop: number, years: number) => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  load: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  addToCompare: () => void;
  removeFromCompare: (id: string) => void;
  renameInCompare: (id: string, name: string) => void;
  clearCompare: () => void;
  refreshSnapshots: () => Promise<void>;
  setCategories: (categories: Category[]) => void;
  addSnapshot: (snap: Snapshot) => Promise<void>;
  deleteSnapshot: (date: string) => Promise<void>;
  setAxisMode: (m: "age" | "year") => void;
}

let simTimer: ReturnType<typeof setTimeout> | null = null;
let simSeq = 0;
// monotonic id source for pinned compare slots; identity that outlives renames
let compareSeq = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
// the scenario waiting to be autosaved to the workspace; set on every edit and
// cleared once written. flushWorkspace() drains it immediately (on tab-hide /
// app-close) so the trailing edit before a teardown is never lost.
let pendingWorkspace: Scenario | null = null;
// set when a scenario edit changes something the success-curve sweep depends on
// (anything but the single planned retirement age); the next simulate then drops
// the now-stale sweep. Retirement-age-only edits leave the sweep curve intact.
let sweepInvalidated = false;
// remember which profile was last open so a reopen restores it (the empty
// string means the Workspace scratchpad). Guarded for non-browser test runs.
const LAST_PROFILE_KEY = "fire:lastProfile";
const readLastProfile = (): string => {
  try { return localStorage.getItem(LAST_PROFILE_KEY) ?? ""; } catch { return ""; }
};
const writeLastProfile = (name: string): void => {
  try { localStorage.setItem(LAST_PROFILE_KEY, name); } catch { /* ignore */ }
};
// the sweep depends on the whole scenario except the planned retirement age,
// which only moves the selected point along the curve, not the curve itself
export const sweepKey = (s: Scenario) => JSON.stringify({ ...s, retirement_age: 0 });

export const useStore = create<AppState>((set, get) => {
  const scheduleSimulate = () => {
    if (simTimer) clearTimeout(simTimer);
    simTimer = setTimeout(async () => {
      const scenario = get().scenario;
      if (!scenario) return;
      const dropSweep = sweepInvalidated;
      sweepInvalidated = false;
      const seq = ++simSeq;
      set({ simulating: true });
      try {
        const result = await api.simulate(withRecordedEarnings(scenario, get().snapshots));
        if (seq === simSeq) {
          // Freedom is stale-while-revalidate: keep the prior bundle visible and
          // recompute it in the background, so the Freedom tab's Coast/FIRE
          // rows don't flicker out on every edit (they used to be nulled here).
          const hadFreedom = get().freedom != null;
          set({
            result, simError: null,
            maxspend: null, surface: null, sensitivity: null, stress: null,
            taxregime: null, laddersavings: null, bridgecrash: null,
            sweep: dropSweep ? null : get().sweep,
          });
          if (hadFreedom) void get().runFreedom();
        }
      } catch (e) {
        if (seq === simSeq) set({ simError: String(e) });
      } finally {
        if (seq === simSeq) set({ simulating: false });
      }
    }, 250);
  };

  return {
    tab: "freedom",
    scenario: null,
    savedAs: "",
    dirty: false,
    result: null,
    simulating: false,
    simError: null,
    sweep: null,
    sweeping: false,
    freedom: null,
    freedomLoading: false,
    maxspend: null,
    maxspendLoading: false,
    surface: null,
    surfaceLoading: false,
    sensitivity: null,
    sensitivityLoading: false,
    stress: null,
    stressLoading: false,
    taxregime: null,
    taxregimeLoading: false,
    laddersavings: null,
    laddersavingsLoading: false,
    bridgecrash: null,
    bridgecrashLoading: false,
    savedScenarios: [],
    compare: [],
    snapshots: [],
    categories: [],
    axisMode: "age",
    sidebarCollapsed: false,
    engineUp: null,

    setTab: (tab) => set({ tab }),
    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

    init: async () => {
      // the bundled engine exe takes a few seconds to unpack on cold start —
      // poll before declaring it down
      let up = false;
      for (let i = 0; i < 15 && !up; i++) {
        try {
          // Fold the engine's schema version into every result-cache key so a
          // schema bump can't serve stale cached numbers (see simCache.ts).
          setCacheSchemaVersion((await api.health()).schema_version);
          up = true;
        } catch {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      set({ engineUp: up });
      if (!up) return;
      const [names, snapshots, categories] = await Promise.all([
        api.listScenarios().then((l) => l.map((x) => x.name)).catch((): string[] => []),
        api.snapshots().catch(() => []),
        api.categories().catch(() => []),
      ]);
      // Reopen wherever the user last was: a named profile if it still exists,
      // otherwise the Workspace scratchpad (the persistent autosaved baseline).
      const last = readLastProfile();
      let scenario: Scenario;
      let savedAs = "";
      try {
        if (last && names.includes(last)) {
          scenario = await api.loadScenario(last);
          savedAs = last;
        } else {
          scenario = await api.getWorkspace();
        }
      } catch {
        scenario = names.length > 0
          ? await api.loadScenario(names[0])
          : await api.defaults();
        savedAs = "";
      }
      scenario = normalizeScenario(scenario);
      // Paint the projection plots immediately from the last run, if this exact
      // profile was simulated before — no spinner, no waiting on the engine. The
      // scheduleSimulate() below revalidates against the same cache (a hit, so a
      // no-op repaint); it only recomputes when the inputs actually changed.
      const cachedResult = getCached<SimulateResult>(
        "simulate", withRecordedEarnings(scenario, snapshots));
      set({ savedScenarios: names, snapshots, categories,
            scenario, savedAs, dirty: false, result: cachedResult });
      scheduleSimulate();
    },

    setScenario: (scenario) => {
      scenario = normalizeScenario(scenario);
      const prev = get().scenario;
      if (!prev || sweepKey(prev) !== sweepKey(scenario)) sweepInvalidated = true;
      set({ scenario, dirty: true });
      scheduleSimulate();
      // Autosave only feeds the workspace scratchpad (savedAs === ""). While a
      // named profile is loaded, edits stay in memory until an explicit Save, so
      // the scratchpad is preserved and remains a place you can switch back to.
      if (get().savedAs !== "") return;
      pendingWorkspace = scenario;
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        const s = pendingWorkspace;
        pendingWorkspace = null;
        if (s) void api.saveWorkspace(s).catch(() => {});
      }, 500);
    },

    patchScenario: (patch) => {
      const s = get().scenario;
      if (!s) return;
      get().setScenario({ ...s, ...patch });
    },

    flushWorkspace: (sync = false) => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      const s = pendingWorkspace;
      pendingWorkspace = null;
      if (!s) return;
      if (sync) api.saveWorkspaceSync(s);
      else void api.saveWorkspace(s).catch(() => {});
    },

    runSweep: async () => {
      const scenario = get().scenario;
      if (!scenario || get().sweeping) return;
      set({ sweeping: true });
      try {
        const sweep = await api.sweep(scenario);
        set({ sweep });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ sweeping: false });
      }
    },

    runFreedom: async () => {
      const scenario = get().scenario;
      if (!scenario || get().freedomLoading) return;
      set({ freedomLoading: true });
      try {
        const freedom = await api.freedom(scenario);
        set({ freedom });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ freedomLoading: false });
      }
    },

    runMaxSpend: async () => {
      const scenario = get().scenario;
      if (!scenario || get().maxspendLoading) return;
      set({ maxspendLoading: true });
      try {
        set({ maxspend: await api.maxSpend(scenario) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ maxspendLoading: false });
      }
    },

    runSurface: async () => {
      const scenario = get().scenario;
      if (!scenario || get().surfaceLoading) return;
      set({ surfaceLoading: true });
      try {
        set({ surface: await api.surface(scenario) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ surfaceLoading: false });
      }
    },

    runSensitivity: async () => {
      const scenario = get().scenario;
      if (!scenario || get().sensitivityLoading) return;
      set({ sensitivityLoading: true });
      try {
        set({ sensitivity: await api.sensitivity(scenario) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ sensitivityLoading: false });
      }
    },

    runStress: async (shockAge, duration) => {
      const scenario = get().scenario;
      if (!scenario || get().stressLoading) return;
      set({ stressLoading: true });
      try {
        set({ stress: await api.stress(scenario, shockAge, duration) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ stressLoading: false });
      }
    },

    runTaxRegime: async (sunsetAge) => {
      const scenario = get().scenario;
      if (!scenario || get().taxregimeLoading) return;
      set({ taxregimeLoading: true });
      try {
        set({ taxregime: await api.taxRegime(scenario, sunsetAge) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ taxregimeLoading: false });
      }
    },

    runLadderSavings: async () => {
      const scenario = get().scenario;
      if (!scenario || get().laddersavingsLoading) return;
      set({ laddersavingsLoading: true });
      try {
        set({ laddersavings: await api.ladderSavings(scenario) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ laddersavingsLoading: false });
      }
    },

    runBridgeCrash: async (drop, years) => {
      const scenario = get().scenario;
      if (!scenario || get().bridgecrashLoading) return;
      set({ bridgecrashLoading: true });
      try {
        set({ bridgecrash: await api.bridgeCrash(scenario, drop, years) });
      } catch (e) {
        set({ simError: String(e) });
      } finally {
        set({ bridgecrashLoading: false });
      }
    },

    saveAs: async (name) => {
      const scenario = get().scenario;
      if (!scenario) return;
      const named = { ...scenario, name };
      await api.saveScenario(name, named);
      // Promote the current buffer to a named profile but leave the workspace
      // scratchpad untouched, so it stays available to switch back to.
      const names = (await api.listScenarios()).map((x) => x.name);
      set({ scenario: named, savedAs: name, dirty: false, savedScenarios: names });
      writeLastProfile(name);
    },

    load: async (name) => {
      // name === "" is the workspace scratchpad; a non-empty name is a saved
      // profile. Loading a named profile must NOT overwrite the workspace, so
      // the scratchpad survives and the user can switch back to it.
      const scenario = normalizeScenario(
        name === "" ? await api.getWorkspace() : await api.loadScenario(name),
      );
      set({ scenario, savedAs: name, dirty: false, result: null, sweep: null, freedom: null });
      writeLastProfile(name);
      scheduleSimulate();
    },

    remove: async (name) => {
      await api.deleteScenario(name);
      const names = (await api.listScenarios()).map((x) => x.name);
      set({ savedScenarios: names });
    },

    addToCompare: () => {
      const { scenario, result, compare, sweep } = get();
      if (!scenario || !result) return;
      let name = scenario.name + (get().dirty ? " (edited)" : "");
      let n = 2;
      while (compare.some((c) => c.name === name)) name = `${scenario.name} (${n++})`;
      // First palette hue not already in use, so colors stay stable as slots come
      // and go; fall back to cycling once every hue is taken.
      const used = new Set(compare.map((c) => c.color));
      const color = COMPARE_PALETTE.find((c) => !used.has(c))
        ?? COMPARE_PALETTE[compare.length % COMPARE_PALETTE.length];
      const id = `cmp-${++compareSeq}`;
      const snapshot = structuredClone(scenario);
      const slot: CompareSlot = {
        id, name, color, scenario: snapshot, result, sweep, sweepPending: !sweep,
        mcNumber: get().freedom?.fire_number_mc ?? null, mcPending: true,
      };
      set({ compare: [...compare, slot] });
      // The MC FIRE number lives on the freedom endpoint, not the simulate result;
      // fetch it for this pinned scenario in the background, resolving back by id.
      api.freedom(snapshot).then((f) => {
        set({
          compare: get().compare.map((c) =>
            c.id === id ? { ...c, mcNumber: f.fire_number_mc, mcPending: false } : c),
        });
      }).catch(() => {
        set({
          compare: get().compare.map((c) =>
            c.id === id ? { ...c, mcPending: false } : c),
        });
      });
      if (!sweep) {
        // compute the success curve for this pinned scenario in the background,
        // resolving back into its slot by stable id (a rename can't lose it)
        api.sweep(snapshot).then((computed) => {
          set({
            compare: get().compare.map((c) =>
              c.id === id ? { ...c, sweep: computed, sweepPending: false } : c),
          });
        }).catch(() => {
          set({
            compare: get().compare.map((c) =>
              c.id === id ? { ...c, sweepPending: false } : c),
          });
        });
      }
    },

    removeFromCompare: (id) =>
      set({ compare: get().compare.filter((c) => c.id !== id) }),

    renameInCompare: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // keep names unique so they stay unambiguous in the legend and table
      let unique = trimmed;
      let n = 2;
      while (get().compare.some((c) => c.id !== id && c.name === unique)) unique = `${trimmed} (${n++})`;
      set({ compare: get().compare.map((c) => (c.id === id ? { ...c, name: unique } : c)) });
    },

    clearCompare: () => set({ compare: [] }),

    refreshSnapshots: async () => set({ snapshots: await api.snapshots() }),

    setCategories: (categories) => {
      set({ categories });
      void api.saveCategories(categories).catch(() => {});
    },

    addSnapshot: async (snap) => {
      await api.addSnapshot(snap);
      await get().refreshSnapshots();
    },

    deleteSnapshot: async (date) => {
      await api.deleteSnapshot(date);
      await get().refreshSnapshots();
    },

    setAxisMode: (axisMode) => set({ axisMode }),
  };
});
