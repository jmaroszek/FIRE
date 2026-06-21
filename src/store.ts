import { create } from "zustand";
import { api } from "./api";
import type {
  BridgeCrashResult, Category, FreedomResult, LadderSavingsResult, MaxSpendResult,
  Scenario, SensitivityResult, SimulateResult, Snapshot, StressResult,
  SurfaceResult, SweepResult, TaxRegimeResult,
} from "./types";

export type Tab =
  | "assumptions" | "cashflow" | "accounts" | "taxes" | "freedom" | "compare" | "settings";

/** Every living expense is subject to inflation — the per-stream Inflates / CPI+
 * controls were removed from the UI, so we enforce the invariant here at the single
 * chokepoint where any scenario enters state (fresh, loaded, or edited). This keeps
 * old saved scenarios and engine requests consistent without surfacing the fields.
 * (Medical streams keep their own CPI+ control, so they're left untouched.) */
function normalizeScenario(s: Scenario): Scenario {
  if (!s.expense_streams?.some((e) => !e.inflates || e.extra_inflation)) return s;
  return {
    ...s,
    expense_streams: s.expense_streams.map((e) =>
      e.inflates && !e.extra_inflation ? e : { ...e, inflates: true, extra_inflation: 0 }),
  };
}

export interface CompareSlot {
  name: string;
  scenario: Scenario;
  result: SimulateResult;
  sweep: SweepResult | null;
  sweepPending?: boolean;
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
  removeFromCompare: (name: string) => void;
  refreshSnapshots: () => Promise<void>;
  setCategories: (categories: Category[]) => void;
  addSnapshot: (snap: Snapshot) => Promise<void>;
  deleteSnapshot: (date: string) => Promise<void>;
  setAxisMode: (m: "age" | "year") => void;
}

let simTimer: ReturnType<typeof setTimeout> | null = null;
let simSeq = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
// set when a scenario edit changes something the success-curve sweep depends on
// (anything but the single planned retirement age); the next simulate then drops
// the now-stale sweep. Retirement-age-only edits leave the sweep curve intact.
let sweepInvalidated = false;
// the sweep depends on the whole scenario except the planned retirement age,
// which only moves the selected point along the curve, not the curve itself
const sweepKey = (s: Scenario) => JSON.stringify({ ...s, retirement_age: 0 });

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
        const result = await api.simulate(scenario);
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
          await api.health();
          up = true;
        } catch {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      set({ engineUp: up });
      if (!up) return;
      const [names, snapshots, categories] = await Promise.all([
        api.listScenarios().then((l) => l.map((x) => x.name)).catch(() => []),
        api.snapshots().catch(() => []),
        api.categories().catch(() => []),
      ]);
      // the autosaved workspace is the persistent baseline; named scenarios
      // are explicit snapshots on top of it
      let scenario: Scenario;
      try {
        scenario = await api.getWorkspace();
      } catch {
        scenario = names.length > 0
          ? await api.loadScenario(names[0])
          : await api.defaults();
      }
      set({ savedScenarios: names, snapshots, categories,
            scenario: normalizeScenario(scenario), savedAs: "", dirty: false });
      scheduleSimulate();
    },

    setScenario: (scenario) => {
      scenario = normalizeScenario(scenario);
      const prev = get().scenario;
      if (!prev || sweepKey(prev) !== sweepKey(scenario)) sweepInvalidated = true;
      set({ scenario, dirty: true });
      scheduleSimulate();
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        void api.saveWorkspace(scenario).catch(() => {});
      }, 800);
    },

    patchScenario: (patch) => {
      const s = get().scenario;
      if (!s) return;
      get().setScenario({ ...s, ...patch });
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
      const names = (await api.listScenarios()).map((x) => x.name);
      set({ scenario: named, savedAs: name, dirty: false, savedScenarios: names });
    },

    load: async (name) => {
      const scenario = normalizeScenario(await api.loadScenario(name));
      set({ scenario, savedAs: name, dirty: false, result: null, sweep: null, freedom: null });
      scheduleSimulate();
      void api.saveWorkspace(scenario).catch(() => {});
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
      const snapshot = structuredClone(scenario);
      const slot: CompareSlot = {
        name, scenario: snapshot, result, sweep, sweepPending: !sweep,
      };
      set({ compare: [...compare, slot] });
      if (!sweep) {
        // compute the success curve for this pinned scenario in the background
        api.sweep(snapshot).then((computed) => {
          set({
            compare: get().compare.map((c) =>
              c.name === name ? { ...c, sweep: computed, sweepPending: false } : c),
          });
        }).catch(() => {
          set({
            compare: get().compare.map((c) =>
              c.name === name ? { ...c, sweepPending: false } : c),
          });
        });
      }
    },

    removeFromCompare: (name) =>
      set({ compare: get().compare.filter((c) => c.name !== name) }),

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
