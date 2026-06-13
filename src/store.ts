import { create } from "zustand";
import { api } from "./api";
import type {
  Category, FreedomResult, Scenario, SimulateResult, Snapshot, SweepResult,
} from "./types";

export type Tab = "dashboard" | "cashflow" | "investing" | "freedom" | "compare" | "settings";

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
  savedScenarios: string[];
  compare: CompareSlot[];
  snapshots: Snapshot[];
  categories: Category[];
  axisMode: "age" | "year";
  display: "real" | "nominal";
  engineUp: boolean | null;

  setTab: (t: Tab) => void;
  init: () => Promise<void>;
  setScenario: (s: Scenario) => void;
  patchScenario: (patch: Partial<Scenario>) => void;
  runSweep: () => Promise<void>;
  runFreedom: () => Promise<void>;
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
  setDisplay: (d: "real" | "nominal") => void;
}

let simTimer: ReturnType<typeof setTimeout> | null = null;
let simSeq = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => {
  const scheduleSimulate = () => {
    if (simTimer) clearTimeout(simTimer);
    simTimer = setTimeout(async () => {
      const scenario = get().scenario;
      if (!scenario) return;
      const seq = ++simSeq;
      set({ simulating: true });
      try {
        const result = await api.simulate(scenario);
        if (seq === simSeq) set({ result, simError: null, sweep: null, freedom: null });
      } catch (e) {
        if (seq === simSeq) set({ simError: String(e) });
      } finally {
        if (seq === simSeq) set({ simulating: false });
      }
    }, 250);
  };

  return {
    tab: "dashboard",
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
    savedScenarios: [],
    compare: [],
    snapshots: [],
    categories: [],
    axisMode: "age",
    display: "real",
    engineUp: null,

    setTab: (tab) => set({ tab }),

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
      set({ savedScenarios: names, snapshots, categories, scenario, savedAs: "", dirty: false });
      scheduleSimulate();
    },

    setScenario: (scenario) => {
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

    saveAs: async (name) => {
      const scenario = get().scenario;
      if (!scenario) return;
      const named = { ...scenario, name };
      await api.saveScenario(name, named);
      const names = (await api.listScenarios()).map((x) => x.name);
      set({ scenario: named, savedAs: name, dirty: false, savedScenarios: names });
    },

    load: async (name) => {
      const scenario = await api.loadScenario(name);
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
    setDisplay: (display) => set({ display }),
  };
});
