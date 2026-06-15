import React, { useEffect, useState } from "react";
import { useStore, type Tab } from "./store";
import Dashboard from "./tabs/Dashboard";
import Plan from "./tabs/Plan";
import Timeline from "./tabs/Timeline";
import Taxes from "./tabs/Taxes";
import Risk from "./tabs/Risk";
import Compare from "./tabs/Compare";
import Settings from "./tabs/Settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "plan", label: "Plan" },
  { id: "timeline", label: "Timeline" },
  { id: "risk", label: "Risk" },
  { id: "taxes", label: "Accounts & Taxes" },
  { id: "compare", label: "Compare" },
  { id: "settings", label: "Settings" },
];

/** The single, always-visible home for the real/nominal and age/year toggles —
 * previously duplicated on Investing, Risk, and Settings. */
function DisplayControls() {
  const { axisMode, setAxisMode, display, setDisplay, scenario } = useStore();
  if (!scenario) return null;
  return (
    <span className="display-controls pair">
      <select value={display} onChange={(e) => setDisplay(e.target.value as "real" | "nominal")}>
        <option value="real">Today's $</option>
        <option value="nominal">Nominal $</option>
      </select>
      <select value={axisMode} onChange={(e) => setAxisMode(e.target.value as "age" | "year")}>
        <option value="age">My Age</option>
        <option value="year">Calendar Year</option>
      </select>
    </span>
  );
}

function ScenarioBar() {
  const { scenario, savedAs, dirty, savedScenarios, saveAs, load, remove } = useStore();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  if (!scenario) return null;

  return (
    <div className="scenario-bar">
      <select
        value={savedAs}
        onChange={(e) => e.target.value && load(e.target.value)}>
        <option value="">{savedAs ? "— Switch Scenario —" : "(Unsaved Scenario)"}</option>
        {savedScenarios.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className="scenario-name">
        {scenario.name}
        {dirty ? (
          <span className="dirty"
            title="Edited since your last named save. Your edits are auto-saved to the workspace continuously — Save stores them under this name.">
            {" "}● Unsaved
          </span>
        ) : savedAs ? (
          <span className="saved-chip" title="No changes since the last save under this name."> · Saved</span>
        ) : (
          <span className="saved-chip" title="Auto-saved to the workspace. Use Save As… to name it."> · Autosaved</span>
        )}
      </span>
      {naming ? (
        <span className="pair">
          <input autoFocus value={name} placeholder="Scenario Name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name && (saveAs(name), setNaming(false))} />
          <button onClick={() => name && (saveAs(name), setNaming(false))}>Save</button>
          <button className="ghost" onClick={() => setNaming(false)}>✕</button>
        </span>
      ) : (
        <span className="pair">
          <button onClick={() => (savedAs ? saveAs(savedAs) : (setName(scenario.name), setNaming(true)))}>
            Save
          </button>
          <button className="ghost" onClick={() => { setName(`${scenario.name} copy`); setNaming(true); }}>
            Save As…
          </button>
          {savedAs && (
            <button className="ghost" title="Delete Saved Scenario"
              onClick={() => { if (confirm(`Delete saved scenario "${savedAs}"?`)) void remove(savedAs); }}>
              🗑
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const { tab, setTab, init, engineUp } = useStore();

  useEffect(() => { void init(); }, []);

  if (engineUp === false) {
    return (
      <div className="offline">
        <h2>Engine Not Running</h2>
        <p>
          Start the Python sidecar first:
          <code>conda activate fire && python server/main.py</code>
          then reload this window.
        </p>
        <button onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>FIRE</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <DisplayControls />
        <ScenarioBar />
      </header>
      <main>
        {tab === "dashboard" && <Dashboard />}
        {tab === "plan" && <Plan />}
        {tab === "timeline" && <Timeline />}
        {tab === "risk" && <Risk />}
        {tab === "taxes" && <Taxes />}
        {tab === "compare" && <Compare />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}
