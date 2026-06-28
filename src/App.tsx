import React, { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type Tab } from "./store";
import { validateScenario } from "./validate";
import { ErrorBoundary } from "./ErrorBoundary";
import Assumptions from "./tabs/Assumptions";
import CashFlow from "./tabs/CashFlow";
import Accounts from "./tabs/Accounts";
import Housing from "./tabs/Housing";
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
    { id: "housing", label: "Housing" },
    { id: "taxes", label: "Taxes" },
  ] },
  { label: "Decide", tabs: [
    { id: "freedom", label: "Freedom" },
    { id: "compare", label: "Compare" },
  ] },
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
        <option value="">Workspace</option>
        {savedScenarios.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className={`status-dot ${dirty ? "is-dirty" : "is-clean"}`}
        title={dirty
          ? (savedAs
              ? "Unsaved changes since your last save under this name — click Save to store them."
              : "Unsaved working changes — auto-saved to the Workspace, but not yet kept under a name. Use Save As… to name it.")
          : (savedAs
              ? "Saved — no changes since your last save under this name."
              : "Workspace is up to date — every edit is auto-saved here.")} />

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

/** Non-blocking advisory banner for inputs that would make the projection
 *  meaningless (errors) or are probably mistakes (warnings). Re-appears whenever
 *  the set of issues changes, even after a dismiss. */
function ValidationBanner() {
  const scenario = useStore((s) => s.scenario);
  const issues = useMemo(() => (scenario ? validateScenario(scenario) : []), [scenario]);
  const sig = issues.map((i) => `${i.level}:${i.field}`).join("|");
  const [dismissed, setDismissed] = useState("");
  if (!issues.length || sig === dismissed) return null;

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const isError = errors.length > 0;
  const accent = isError ? "#f85149" : "#d29922";

  return (
    <div role="alert" style={{
      margin: "0 0 12px", padding: "10px 14px", borderRadius: 6,
      borderLeft: `3px solid ${accent}`, background: "#1c2128", color: "#c9d1d9",
      fontSize: 13, lineHeight: 1.5,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ color: accent }}>
          {isError
            ? `${errors.length} input ${errors.length === 1 ? "issue" : "issues"} — results may be meaningless`
            : `${warnings.length} input ${warnings.length === 1 ? "warning" : "warnings"}`}
        </strong>
        <button className="ghost" style={{ color: "#8b949e" }}
          title="Dismiss until the inputs change" onClick={() => setDismissed(sig)}>✕</button>
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {[...errors, ...warnings].map((i) => (
          <li key={`${i.level}:${i.field}`}>
            <span style={{ color: "#8b949e" }}>{i.field}</span> — {i.message}
          </li>
        ))}
      </ul>
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
          <button className={`navitem navitem-gear${tab === "settings" ? " active" : ""}`}
            title="Settings" onClick={() => setTab("settings")}>
            <span className="gear-icon" aria-hidden="true">⚙</span> Settings
          </button>
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
          <ValidationBanner />
          <ErrorBoundary key={tab}>
            {tab === "assumptions" && <Assumptions />}
            {tab === "cashflow" && <CashFlow />}
            {tab === "accounts" && <Accounts />}
            {tab === "housing" && <Housing />}
            {tab === "taxes" && <Taxes />}
            {tab === "freedom" && <Freedom />}
            {tab === "compare" && <Compare />}
            {tab === "settings" && <Settings />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
