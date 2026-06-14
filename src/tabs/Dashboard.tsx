import React, { useEffect, useState } from "react";
import { A } from "../assumptions";
import { FanChart, percentileAt } from "../components/charts";
import { Field, InfoTip, NumberInput, Section, Stat, fmtMoney, fmtPct } from "../components/ui";
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

interface SnapDraft {
  balances: Record<string, number>;
  spending: Record<string, number>;
  liabilities: Record<string, number>;
}

export default function Dashboard() {
  const { scenario, result, freedom, freedomLoading, runFreedom, snapshots, categories,
          addSnapshot, deleteSnapshot, axisMode, display } = useStore();
  const [snapDraft, setSnapDraft] = useState<SnapDraft | null>(null);
  // Compute the Coast/FIRE bundle on mount so the headline is populated without
  // requiring a visit to Freedom; the store keeps it fresh (stale-while-revalidate).
  useEffect(() => {
    if (scenario && !freedom && !freedomLoading) void runFreedom();
  }, [scenario, freedom]);
  if (!scenario) return null;

  const pools = poolBalances(scenario.accounts);
  const assets = Object.values(pools).reduce((a, b) => a + b, 0);
  const debt = (scenario.liabilities ?? []).reduce((a, l) => a + l.balance, 0);
  const total = assets - debt;
  const retMarker = axisMode === "age"
    ? scenario.retirement_age
    : scenario.profile.birth_year + scenario.retirement_age;

  // Where the latest snapshot lands in the original projection cone for its year.
  // Compared in nominal $ (the fan's nominal series), so the CPI deflator cancels;
  // the fan index matches how the chart plots the snapshot dot (x = snapshot year).
  const latestSnap = snapshots[snapshots.length - 1];
  let trackingLabel: string | null = null;
  if (result && latestSnap) {
    const snapTotal = Object.values(latestSnap.balances).reduce((a, b) => a + b, 0);
    const i = new Date(latestSnap.date).getFullYear() - scenario.sim.start_year + 1;
    const fanNom = result.fan.nominal;
    if (i >= 0 && i < fanNom.p50.length) trackingLabel = percentileAt(fanNom, i, snapTotal);
  }

  return (
    <div className="stack">
      <div className="stat-grid">
        <Section title="Net Worth">
          <Stat label={debt > 0 ? "Assets Minus Liabilities" : "Total Across All Pools"}
            value={fmtMoney(total)} />
          <table className="table">
            <tbody>
              {POOLS.map((p) => (
                <tr key={p}>
                  <td>{POOL_LABELS[p]}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(pools[p])}</td>
                  <td style={{ textAlign: "right", color: "#8b949e" }}>
                    {assets > 0 ? fmtPct(pools[p] / assets, 0) : "—"}
                  </td>
                </tr>
              ))}
              {(scenario.liabilities ?? []).filter((l) => l.balance > 0).map((l) => (
                <tr key={l.name}>
                  <td style={{ color: "#ff7b72" }}>{l.name}</td>
                  <td style={{ textAlign: "right", color: "#ff7b72" }}>
                    −{fmtMoney(l.balance)}
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Headline">
          {result && (
            <Stat label="Plan Success Probability" value={fmtPct(result.success_rate)}
              sub={`95% CI ${fmtPct(result.success_ci.lo)}–${fmtPct(result.success_ci.hi)} · ${result.success_ci.n_paths.toLocaleString()} paths`}
              info={A.successCi} />
          )}
          {trackingLabel && (
            <Stat label="Tracking vs Plan" value={trackingLabel}
              sub={`latest snapshot ${latestSnap!.date}`} info={A.vsPlan} />
          )}
          {freedom && (
            <>
              <Stat label="Coast Progress" value={fmtPct(freedom.coast.progress)} />
              <Stat label="FIRE Progress (MC)" value={fmtPct(freedom.fire_progress_mc)} />
            </>
          )}
          {!result && <p className="hint">Simulation pending…</p>}
        </Section>

        <Section title="Record A Snapshot" info={A.snapshots}>
          {snapDraft ? (
            <>
              <div className="snap-head">Balances</div>
              {POOLS.map((p) => (
                <Field key={p} label={POOL_LABELS[p]}>
                  <NumberInput value={snapDraft.balances[p] ?? 0} step={500}
                    onChange={(v) => setSnapDraft({
                      ...snapDraft, balances: { ...snapDraft.balances, [p]: v },
                    })} />
                </Field>
              ))}
              <div className="snap-head">
                Annual Spending
                <InfoTip text="Nominal dollars per year at today's prices, summed from your budget's category totals. Sinking-fund contributions count as spending in their category; income taxes and loan payments are tracked elsewhere." />
              </div>
              {categories.map((c) => (
                <Field key={c.slug} label={c.name}>
                  <NumberInput value={snapDraft.spending[c.slug] ?? 0} step={250}
                    onChange={(v) => setSnapDraft({
                      ...snapDraft, spending: { ...snapDraft.spending, [c.slug]: v },
                    })} />
                </Field>
              ))}
              {(scenario.liabilities ?? []).length > 0 && (
                <>
                  <div className="snap-head">Loan Balances</div>
                  {(scenario.liabilities ?? []).map((l) => (
                    <Field key={l.name} label={l.name}>
                      <NumberInput value={snapDraft.liabilities[l.name] ?? 0} step={1000}
                        onChange={(v) => setSnapDraft({
                          ...snapDraft, liabilities: { ...snapDraft.liabilities, [l.name]: v },
                        })} />
                    </Field>
                  ))}
                </>
              )}
              <div className="pair" style={{ marginTop: 8 }}>
                <button onClick={async () => {
                  await addSnapshot({
                    date: new Date().toISOString().slice(0, 10),
                    ...snapDraft,
                  });
                  setSnapDraft(null);
                }}>Save</button>
                <button className="ghost" onClick={() => setSnapDraft(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              {snapshots.length > 0 ? (
                <table className="table">
                  <tbody>
                    {snapshots.map((snap) => {
                      const spendTotal = Object.values(snap.spending ?? {}).reduce((a, b) => a + b, 0);
                      return (
                        <tr key={snap.date}>
                          <td>{snap.date}</td>
                          <td style={{ textAlign: "right" }}>
                            {fmtMoney(Object.values(snap.balances).reduce((a, b) => a + b, 0))}
                          </td>
                          <td style={{ textAlign: "right", color: "#8b949e" }}>
                            {spendTotal > 0 ? `${fmtMoney(spendTotal)}/yr` : ""}
                          </td>
                          <td>
                            <button className="ghost" title="Delete Snapshot"
                              onClick={() => deleteSnapshot(snap.date)}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="hint">No snapshots recorded yet.</p>
              )}
              <button onClick={() => {
                const last = snapshots[snapshots.length - 1];
                setSnapDraft({
                  balances: pools,
                  spending: { ...(last?.spending ?? {}) },
                  liabilities: Object.fromEntries(
                    (scenario.liabilities ?? []).map((l) => [l.name, l.balance])),
                });
              }}>+ Snapshot Today</button>
            </>
          )}
        </Section>
      </div>

      <Section title="Actuals vs Projection" info={A.actualsVsProjection}>
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
