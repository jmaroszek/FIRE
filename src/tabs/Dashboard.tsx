import React, { useState } from "react";
import { A } from "../assumptions";
import { FanChart } from "../components/charts";
import { Field, NumberInput, Section, Stat, fmtMoney, fmtPct } from "../components/ui";
import { useStore } from "../store";

const POOLS = ["taxable", "trad", "roth", "hsa", "cash"] as const;
const POOL_LABELS: Record<string, string> = {
  taxable: "Taxable", trad: "Traditional", roth: "Roth", hsa: "HSA", cash: "Cash",
};

function poolBalances(accounts: { type: string; balance: number }[]) {
  const out: Record<string, number> = { taxable: 0, trad: 0, roth: 0, hsa: 0, cash: 0 };
  for (const a of accounts) {
    const pool =
      a.type === "taxable" ? "taxable"
      : a.type === "cash" ? "cash"
      : a.type === "hsa" ? "hsa"
      : a.type.startsWith("trad") ? "trad" : "roth";
    out[pool] += a.balance;
  }
  return out;
}

export default function Dashboard() {
  const { scenario, result, freedom, snapshots, addSnapshot, axisMode, display } = useStore();
  const [snapDraft, setSnapDraft] = useState<Record<string, number> | null>(null);
  if (!scenario) return null;

  const pools = poolBalances(scenario.accounts);
  const total = Object.values(pools).reduce((a, b) => a + b, 0);
  const retMarker = axisMode === "age"
    ? scenario.retirement_age
    : scenario.profile.birth_year + scenario.retirement_age;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Net worth">
          <Stat label="Total across all pools" value={fmtMoney(total)} />
          <table className="table">
            <tbody>
              {POOLS.map((p) => (
                <tr key={p}>
                  <td>{POOL_LABELS[p]}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(pools[p])}</td>
                  <td style={{ textAlign: "right", color: "#8b949e" }}>
                    {total > 0 ? fmtPct(pools[p] / total, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Headline">
          {result && (
            <Stat label="Plan success probability" value={fmtPct(result.success_rate)}
              sub={`retire at ${scenario.retirement_age}, horizon ${scenario.profile.horizon_age}`}
              info={A.successRate} />
          )}
          {freedom && (
            <>
              <Stat label="FIRE progress (MC)" value={fmtPct(freedom.fire_progress_mc)} />
              <Stat label="Coast progress" value={fmtPct(freedom.coast.progress)} />
            </>
          )}
          {!result && <p className="hint">Simulation pending…</p>}
        </Section>

        <Section title="Record a snapshot" info={A.snapshots}>
          {snapDraft ? (
            <>
              {POOLS.map((p) => (
                <Field key={p} label={POOL_LABELS[p]}>
                  <NumberInput value={snapDraft[p] ?? 0} step={500}
                    onChange={(v) => setSnapDraft({ ...snapDraft, [p]: v })} />
                </Field>
              ))}
              <div className="pair">
                <button onClick={async () => {
                  await addSnapshot({
                    date: new Date().toISOString().slice(0, 10),
                    balances: snapDraft,
                  });
                  setSnapDraft(null);
                }}>save</button>
                <button className="ghost" onClick={() => setSnapDraft(null)}>cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">{snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} recorded.</p>
              <button onClick={() => setSnapDraft(pools)}>+ snapshot today</button>
            </>
          )}
        </Section>
      </div>

      <Section title="Actuals vs projection" info={A.snapshots}>
        {result ? (
          <FanChart
            result={result}
            axisMode={axisMode}
            display={display}
            retirementMarker={retMarker}
            snapshots={snapshots}
            startYear={scenario.sim.start_year}
            birthYear={scenario.profile.birth_year}
          />
        ) : (
          <p className="hint">Simulation pending…</p>
        )}
      </Section>
    </div>
  );
}
