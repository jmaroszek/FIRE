import { create } from "zustand";
import { api } from "./api";
import type {
  FreedomResult, Scenario, SimulateResult, Snapshot, SweepResult,
} from "./types";

export type Tab = "dashboard" | "inputs" | "simulate" | "freedom" | "compare" | "settings";

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
  addSnapshot: (snap: Snapshot) => Promise<void>;
  setAxisMode: (m: "age" | "year") => void;
  setDisplay: (d: "real" | "nominal") => void;
}

let simTimer: ReturnType<typeof setTimeout> | null = null;
let simSeq = 0;

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
    axisMode: "age",
    display: "real",
    engineUp: null,

    setTab: (tab) => set({ tab }),

    init: async () => {
      try {
        await api.health();
        set({ engineUp: true });
      } catch {
        set({ engineUp: false });
        return;
      }
      const [names, snapshots] = await Promise.all([
        api.listScenarios().then((l) => l.map((x) => x.name)).catch(() => []),
        api.snapshots().catch(() => []),
      ]);
      let scenario: Scenario;
      let savedAs = "";
      if (names.length > 0) {
        scenario = await api.loadScenario(names[0]);
        savedAs = names[0];
      } else {
        scenario = await api.defaults();
      }
      set({ savedScenarios: names, snapshots, scenario, savedAs, dirty: false });
      scheduleSimulate();
    },

    setScenario: (scenario) => {
      set({ scenario, dirty: true });
      scheduleSimulate();
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

    addSnapshot: async (snap) => {
      await api.addSnapshot(snap);
      await get().refreshSnapshots();
    },

    setAxisMode: (axisMode) => set({ axisMode }),
    setDisplay: (display) => set({ display }),
  };
});
