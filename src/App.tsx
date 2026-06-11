import React, { useEffect, useState } from "react";
import { useStore, type Tab } from "./store";
import Dashboard from "./tabs/Dashboard";
import Inputs from "./tabs/Inputs";
import Simulate from "./tabs/Simulate";
import Freedom from "./tabs/Freedom";
import Compare from "./tabs/Compare";
import Settings from "./tabs/Settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inputs", label: "Inputs" },
  { id: "simulate", label: "Simulate" },
  { id: "freedom", label: "Freedom" },
  { id: "compare", label: "Compare" },
  { id: "settings", label: "Settings" },
];

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
        <option value="">{savedAs ? "— switch scenario —" : "(unsaved scenario)"}</option>
        {savedScenarios.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className="scenario-name">
        {scenario.name}{dirty && <span className="dirty" title="unsaved changes"> ●</span>}
      </span>
      {naming ? (
        <span className="pair">
          <input autoFocus value={name} placeholder="scenario name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name && (saveAs(name), setNaming(false))} />
          <button onClick={() => name && (saveAs(name), setNaming(false))}>save</button>
          <button className="ghost" onClick={() => setNaming(false)}>✕</button>
        </span>
      ) : (
        <span className="pair">
          <button onClick={() => (savedAs ? saveAs(savedAs) : (setName(scenario.name), setNaming(true)))}>
            save
          </button>
          <button className="ghost" onClick={() => { setName(`${scenario.name} copy`); setNaming(true); }}>
            save as…
          </button>
          {savedAs && (
            <button className="ghost" title="delete saved scenario"
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
        <h2>Engine not running</h2>
        <p>
          Start the Python sidecar first:
          <code>conda activate fire && python server/main.py</code>
          then reload this window.
        </p>
        <button onClick={() => location.reload()}>retry</button>
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
        <ScenarioBar />
      </header>
      <main>
        {tab === "dashboard" && <Dashboard />}
        {tab === "inputs" && <Inputs />}
        {tab === "simulate" && <Simulate />}
        {tab === "freedom" && <Freedom />}
        {tab === "compare" && <Compare />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}
