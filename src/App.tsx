import React, { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Tab } from "./store";
import Assumptions from "./tabs/Assumptions";
import CashFlow from "./tabs/CashFlow";
import Accounts from "./tabs/Accounts";
import Taxes from "./tabs/Taxes";
import Freedom from "./tabs/Freedom";
import Compare from "./tabs/Compare";
import Settings from "./tabs/Settings";

/** Journey-ordered, grouped navigation: define your assumptions, build the plan
 *  across the money tabs, then read the verdict on Freedom. */
const GROUPS: { label: string; tabs: { id: Tab; label: string }[] }[] = [
  { label: "Setup", tabs: [{ id: "assumptions", label: "Assumptions" }] },
  { label: "Plan", tabs: [
    { id: "cashflow", label: "Cash Flow" },
    { id: "accounts", label: "Accounts" },
    { id: "taxes", label: "Taxes" },
  ] },
  { label: "Decide", tabs: [{ id: "freedom", label: "Freedom" }] },
];
const UTILITY: { id: Tab; label: string }[] = [
  { id: "compare", label: "Compare" },
  { id: "settings", label: "Settings" },
];

/** The single, always-visible home for the age/year lens. Every chart reports in
 *  today's dollars, so there's no real/nominal control — see the Settings note. */
function DisplayControls() {
  const { axisMode, setAxisMode, scenario } = useStore(useShallow((s) => ({
    axisMode: s.axisMode, setAxisMode: s.setAxisMode, scenario: s.scenario,
  })));
  if (!scenario) return null;
  return (
    <span className="display-controls pair">
      <select value={axisMode} onChange={(e) => setAxisMode(e.target.value as "age" | "year")}>
        <option value="age">My Age</option>
        <option value="year">Calendar Year</option>
      </select>
    </span>
  );
}

/** Slim scenario control: a switcher that shows the current name, a dirty dot,
 *  a Save button (prominent only when dirty), and Save As… / Delete in overflow. */
function ScenarioBar() {
  const { scenario, savedAs, dirty, savedScenarios, saveAs, load, remove } = useStore(useShallow((s) => ({
    scenario: s.scenario, savedAs: s.savedAs, dirty: s.dirty, savedScenarios: s.savedScenarios,
    saveAs: s.saveAs, load: s.load, remove: s.remove,
  })));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  if (!scenario) return null;

  const commit = () => { if (name) { void saveAs(name); setNaming(false); setName(""); } };

  if (naming) {
    return (
      <div className="scenario-bar">
        <input autoFocus value={name} placeholder="Scenario Name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()} />
        <button onClick={commit}>Save</button>
        <button className="ghost" onClick={() => { setNaming(false); setName(""); }}>✕</button>
      </div>
    );
  }

  return (
    <div className="scenario-bar">
      <select className="scenario-switch" value={savedAs} title="Switch scenario"
        onChange={(e) => { const v = e.target.value; if (v !== savedAs) void load(v); }}>
        {savedAs === "" && <option value="">{scenario.name} (unsaved)</option>}
        {savedScenarios.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {dirty ? (
        <span className="dirty"
          title="Edited since your last named save. Your edits are auto-saved to the workspace continuously — Save stores them under this name.">●</span>
      ) : (
        <span className="saved-chip"
          title={savedAs ? "No changes since the last save under this name." : "Auto-saved to the workspace. Use Save As… to name it."}>
          {savedAs ? "Saved" : "Autosaved"}
        </span>
      )}
      <button className={dirty ? "" : "ghost"}
        onClick={() => (savedAs ? void saveAs(savedAs) : (setName(scenario.name), setNaming(true)))}>
        Save
      </button>
      <span className="overflow">
        <button className="ghost" title="More" onClick={() => setMenuOpen((o) => !o)}>⋯</button>
        {menuOpen && (
          <span className="overflow-menu" onMouseLeave={() => setMenuOpen(false)}>
            <button className="ghost" onClick={() => {
              setName(`${scenario.name} copy`); setNaming(true); setMenuOpen(false);
            }}>Save As…</button>
            {savedAs && (
              <button className="ghost" onClick={() => {
                if (confirm(`Delete saved scenario "${savedAs}"?`)) void remove(savedAs);
                setMenuOpen(false);
              }}>Delete</button>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export default function App() {
  const { tab, setTab, init, engineUp, sidebarCollapsed, setSidebarCollapsed } = useStore(useShallow((s) => ({
    tab: s.tab, setTab: s.setTab, init: s.init, engineUp: s.engineUp,
    sidebarCollapsed: s.sidebarCollapsed, setSidebarCollapsed: s.setSidebarCollapsed,
  })));

  useEffect(() => { void init(); }, []);

  // Drain any pending workspace edit before the document tears down — a tab
  // close, an app quit, or a dev hot-reload. Without this, the trailing edit
  // inside the autosave debounce window is silently lost. visibilitychange
  // (fires reliably when the page is hidden) uses a normal request; the
  // beforeunload backstop uses a keepalive request that outlives the page.
  useEffect(() => {
    const flush = useStore.getState().flushWorkspace;
    const onHide = () => { if (document.visibilityState === "hidden") flush(false); };
    const onUnload = () => flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  if (engineUp === false) {
    return (
      <div className="offline">
        <h2>Engine Not Running</h2>
        <p>
          Start the Python sidecar first:
          <code>conda activate fire &amp;&amp; python server/main.py</code>
          then reload this window.
        </p>
        <button onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className={sidebarCollapsed ? "app collapsed" : "app"}>
      <aside className="sidebar">
        <div className="sidebar-brand">FIRE</div>
        <nav className="sidebar-nav">
          {GROUPS.map((g) => (
            <div className="sidebar-group" key={g.label}>
              <div className="sidebar-group-label">{g.label}</div>
              {g.tabs.map((t) => (
                <button key={t.id} className={tab === t.id ? "navitem active" : "navitem"}
                  onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          ))}
          <div className="sidebar-spacer" />
          <div className="sidebar-group">
            {UTILITY.map((t) => (
              <button key={t.id} className={tab === t.id ? "navitem active" : "navitem"}
                onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
        </nav>
      </aside>

      <div className="content">
        <div className="topbar">
          <button className="ghost sidebar-toggle"
            title={sidebarCollapsed ? "Show navigation" : "Hide navigation"}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>☰</button>
          <DisplayControls />
          <ScenarioBar />
        </div>
        <main>
          {tab === "assumptions" && <Assumptions />}
          {tab === "cashflow" && <CashFlow />}
          {tab === "accounts" && <Accounts />}
          {tab === "taxes" && <Taxes />}
          {tab === "freedom" && <Freedom />}
          {tab === "compare" && <Compare />}
          {tab === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}
