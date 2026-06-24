// Penalty-free accessibility, account composition, and contribution/withdrawal flows.
import React, { useRef, useState } from "react";
import type { Data, Layout, Shape } from "plotly.js";
import type { CompareSlot } from "../../store";
import type {
  Category, FanSeries, SensitivityResult, SimulateResult, Snapshot, SurfaceResult, SweepResult,
} from "../../types";
import { POOL_LABELS, SOURCE_LABELS } from "../../labels";
import { fmtTipMoney } from "../../format";
import { median, percentileAt } from "../../math";
import { PENALTY_FREE_AGE } from "../../constants";
import {
  ACCENT, CONTRIB_COLORS, CONTRIB_LABELS, FLOW_COLORS, POOL_COLORS, POOL_ORDER,
  Plot, SOURCE_COLORS, baseLayout, config, lifeStageMarkers, xValues, yHover, yTick,
  type LifeMark, type YFmt,
} from "../chartShared";
import { SeriesChart } from "./series";


export const AccessibilityChart = React.memo(function AccessibilityChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementMarker?: number | null; birthYear?: number; height?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const order = ["cash", "taxable", "roth_basis", "roth_matured_conversions",
                 "trad", "hsa", "roth_earnings"];
  const present = order.filter((src) => props.result.accessibility_real[src]);
  const data: Data[] = present.map((src) => ({
    x: [...x],
    y: props.result.accessibility_real[src],
    type: "scatter" as const,
    mode: "lines" as const,
    stackgroup: "one",
    name: SOURCE_LABELS[src as keyof typeof SOURCE_LABELS] ?? src,
    line: { width: 0.5, color: SOURCE_COLORS[src] },
    fillcolor: SOURCE_COLORS[src] + "66",
    hovertemplate: "%{y:$,.0f}",
  }));
  // Transparent overlay so unified hover gets a "Total" row summing every
  // source at that year; sits atop the stack and draws nothing.
  const totals = [...x].map((_, i) =>
    present.reduce((sum, src) => sum + (props.result.accessibility_real[src][i] ?? 0), 0));
  data.push({
    x: [...x], y: totals, type: "scatter", mode: "lines", name: "Total",
    line: { width: 0 }, showlegend: false,
    hovertemplate: "Total accessible: %{y:$,.0f}<extra></extra>",
  });

  // Frame the bridge window: from retirement to 59½, when traditional and Roth
  // earnings become penalty-free (the model's annual grain unlocks them at 60).
  const shapes: Partial<Shape>[] = [];
  const annotations: Partial<Layout["annotations"][number]>[] = [];
  const pf = props.axisMode === "age" ? 59.5 : (props.birthYear ?? 0) + 59.5;
  shapes.push({
    type: "line", x0: pf, x1: pf, y0: 0, y1: 1, yref: "paper",
    line: { color: "#f0883e", width: 1.5, dash: "dash" },
  });
  annotations.push({
    x: pf, y: 1, yref: "paper", text: "59½", showarrow: false,
    yanchor: "bottom", font: { color: "#f0883e", size: 11 },
  });
  if (props.retirementMarker != null) {
    shapes.push({
      type: "line", x0: props.retirementMarker, x1: props.retirementMarker,
      y0: 0, y1: 1, yref: "paper",
      line: { color: "#8b949e", width: 1.5, dash: "dash" },
    });
    annotations.push({
      x: props.retirementMarker, y: 1, yref: "paper",
      text: `Retire ${props.retirementMarker}`, showarrow: false,
      yanchor: "bottom", font: { color: "#8b949e", size: 11 },
    });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 400,
        hovermode: "x unified",
        shapes, annotations: annotations as Layout["annotations"],
        // Reverse the legend so it reads in withdrawal-policy order; the stack
        // order (set by trace order in `data`) is unchanged.
        legend: { ...baseLayout.legend, traceorder: "reversed" },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const AccessibilityFanChart = React.memo(function AccessibilityFanChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementMarker?: number | null; retirementAge?: number | null;
  birthYear?: number; height?: number;
}) {
  const rawFan = props.result.accessibility_fan;
  const ages = props.result.ages;
  const xRaw = props.axisMode === "age" ? [...ages] : [...props.result.years];
  if (!rawFan || !rawFan.p50) return <p className="hint">Simulation pending…</p>;

  // Clip every series at age 60. The bridge ends at 59½; once traditional
  // unlocks at 60 the lines shoot up, and even with the x-axis capped Plotly
  // would draw the 59→60 segment rising into view as a spike at the right edge.
  // Dropping the age-60+ points removes that segment entirely.
  const cut = ages.findIndex((a) => a >= PENALTY_FREE_AGE);
  const end = cut === -1 ? ages.length : cut;
  const x = xRaw.slice(0, end);
  const fan: Record<string, number[]> = {};
  for (const k of Object.keys(rawFan)) fan[k] = (rawFan as any)[k].slice(0, end);

  // Focus the view on the bridge era. After 59½ the traditional pool unlocks and
  // decades of compounding blow the y-scale into the tens of millions, burying the
  // bridge detail this chart exists to show — so cap both axes a few years past 60.
  let xRange: [number, number] | undefined;
  let yRange: [number, number] | undefined;
  if (props.retirementAge != null) {
    const ra = props.retirementAge;
    const off = props.axisMode === "age" ? 0 : (props.birthYear ?? 0);
    // The chart ends at the 59½ marker (data is already clipped before age 60),
    // so the unlock spike never enters the view.
    xRange = [ra - 3 + off, 59.5 + off];
    // scale to the pre-60 (penalty-locked) era only.
    let ymax = 0;
    for (let i = 0; i < end; i++) {
      if (ages[i] >= ra - 1 && ages[i] < 60) ymax = Math.max(ymax, fan.p90[i] ?? 0);
    }
    if (ymax > 0) yRange = [0, ymax * 1.12];
  }

  const band = (lo: string, hi: string, color: string, label: string): Data[] => [
    { x, y: fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x, y: fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: color, line: { width: 0 }, name: label, hoverinfo: "skip" },
  ];
  // Invisible (width-0) lines purely to surface a value in the unified hover for
  // the band-boundary percentiles that have no drawn line of their own. Plotly
  // orders x-unified entries top-to-bottom by y position, so 90 lands at the top
  // and 10 at the bottom automatically.
  const hoverOnly = (key: string, name: string): Data => ({
    x, y: fan[key], type: "scatter", mode: "lines", name,
    line: { width: 0 }, showlegend: false, hovertemplate: "%{y:$,.0f}",
  });
  // Order matters: Plotly lists x-unified hover entries in REVERSE trace order
  // (last trace on top), so add low→high to get 90th at the top, 10th at bottom.
  const data: Data[] = [
    ...band("p10", "p90", "rgba(63,185,80,0.10)", "10–90%"),
    ...band("p25", "p75", "rgba(63,185,80,0.22)", "25–75%"),
    { x, y: fan.p10, type: "scatter", mode: "lines", name: "Worst 10%",
      line: { color: "#ff7b72", width: 1.5, dash: "dot" }, hovertemplate: "%{y:$,.0f}" },
    hoverOnly("p25", "25th"),
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median (50th)",
      line: { color: "#3fb950", width: 2.5 }, hovertemplate: "%{y:$,.0f}" },
    hoverOnly("p75", "75th"),
    hoverOnly("p90", "90th"),
  ];

  const shapes: Partial<Shape>[] = [];
  const annotations: Partial<Layout["annotations"][number]>[] = [];
  // The x-axis already ends at 59½ (data is clipped before 60), so a dashed
  // guide there would just sit on the edge — omit it.
  if (props.retirementMarker != null) {
    shapes.push({ type: "line", x0: props.retirementMarker, x1: props.retirementMarker,
      y0: 0, y1: 1, yref: "paper", line: { color: "#8b949e", width: 1.5, dash: "dash" } });
    annotations.push({ x: props.retirementMarker, y: 1, yref: "paper",
      text: `Retire ${props.retirementMarker}`, showarrow: false,
      yanchor: "bottom", font: { color: "#8b949e", size: 11 } });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified",
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: {
          ...baseLayout.yaxis, tickformat: "$.3~s",
          ...(yRange ? { range: yRange, autorange: false } : { rangemode: "tozero" }),
        },
        xaxis: {
          ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" },
          ...(xRange ? { range: xRange } : {}),
        },
        title: { text: "Total Penalty-Free Assets — Percentile Fan, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const AccountFlowsChart = React.memo(function AccountFlowsChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge?: number; birthYear?: number; height?: number;
}) {
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const inv = props.result.investing_real ?? {};
  const w = props.result.withdrawals_real ?? {};
  const wages = props.result.wages_median_real ?? [];
  const ssInc = props.result.ss_income_median_real ?? [];
  const inOrder = ["match", "trad", "roth", "hsa", "taxable", "cash"];
  const outOrder = ["cash", "taxable", "roth_basis", "roth_matured_conversions",
                    "trad", "hsa", "roth_earnings"];
  const cIn = inOrder.filter((k) => inv[k]?.some((v) => v > 1));
  const cOut = outOrder.filter((k) => w[k]?.some((v) => v > 1));
  const hasWork = wages.some((v) => v > 1);
  const hasSS = ssInc.some((v) => v > 1);
  if (!cIn.length && !cOut.length && !hasWork && !hasSS)
    return <p className="hint">No account flows on the median path yet.</p>;

  // With x-unified hover, plotly lists every trace at the hovered x — including
  // accounts sitting at $0 that year. Nulling those points (the bar is 0-height
  // anyway) drops just those rows, so each year's tooltip names only the accounts
  // with real activity. The account name rides in the hovertemplate body (the
  // colored swatch alone doesn't say which account it is).
  const data: Data[] = [];
  cIn.forEach((k, i) => data.push({
    x, y: inv[k].map((v) => (v > 1 ? v : null)), type: "bar", name: CONTRIB_LABELS[k] ?? k,
    legendgroup: "in",
    ...(i === 0 ? { legendgrouptitle: { text: "Contributions" } } : {}),
    marker: { color: (CONTRIB_COLORS[k] ?? "#8b949e") + "cc" },
    hovertemplate: `${CONTRIB_LABELS[k] ?? k} %{y:$,.0f}<extra></extra>`,
  } as Data));
  // a transparent marker carrying the year's total contributions — appears as a
  // "Total" row at the foot of the Contributions group in the unified tooltip.
  if (cIn.length) {
    const inTotal = x.map((_, t) => {
      const sum = cIn.reduce((a, k) => a + (inv[k]?.[t] ?? 0), 0);
      return sum > 1 ? sum : null;
    });
    data.push({
      x, y: inTotal, type: "scatter", mode: "markers", name: "Total Contributions",
      legendgroup: "in", showlegend: false, marker: { color: "rgba(0,0,0,0)" },
      hovertemplate: "<b>Total %{y:$,.0f}</b><extra></extra>",
    } as Data);
  }
  cOut.forEach((k, i) => data.push({
    x, y: w[k].map((v) => (v > 1 ? -v : null)), type: "bar", name: SOURCE_LABELS[k as keyof typeof SOURCE_LABELS] ?? k,
    legendgroup: "out",
    ...(i === 0 ? { legendgrouptitle: { text: "Withdrawals" } } : {}),
    marker: { color: (SOURCE_COLORS[k] ?? "#8b949e") + "cc" },
    customdata: w[k], hovertemplate: `${SOURCE_LABELS[k as keyof typeof SOURCE_LABELS] ?? k} %{customdata:$,.0f}<extra></extra>`,
  } as Data));
  if (cOut.length) {
    const outTotal = x.map((_, t) => {
      const sum = cOut.reduce((a, k) => a + (w[k]?.[t] ?? 0), 0);
      return sum > 1 ? sum : null;
    });
    data.push({
      x, y: outTotal.map((v) => (v == null ? null : -v)), type: "scatter", mode: "markers",
      name: "Total Withdrawals", legendgroup: "out", showlegend: false,
      marker: { color: "rgba(0,0,0,0)" }, customdata: outTotal,
      hovertemplate: "<b>Total %{customdata:$,.0f}</b><extra></extra>",
    } as Data);
  }
  if (hasWork) data.push({
    x, y: wages.map((v) => (v > 1 ? v : null)), type: "scatter", mode: "lines",
    name: "Active Income (Work)",
    legendgroup: "income", legendgrouptitle: { text: "Income" },
    line: { color: FLOW_COLORS.wages, width: 2 },
    hovertemplate: "Work income %{y:$,.0f}<extra></extra>",
  });
  if (hasSS) data.push({
    x, y: ssInc.map((v) => (v > 1 ? v : null)), type: "scatter", mode: "lines",
    name: "Social Security",
    legendgroup: "income",
    ...(hasWork ? {} : { legendgrouptitle: { text: "Income" } }),
    line: { color: FLOW_COLORS.ss, width: 2, dash: "dot" },
    hovertemplate: "Social Security %{y:$,.0f}<extra></extra>",
  });

  const marks: LifeMark[] = [];
  if (props.retirementAge) marks.push({ age: props.retirementAge, label: "Retire", color: "#d29922" });
  const lsm = lifeStageMarkers(props.axisMode, props.birthYear, marks);

  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 380, hovermode: "x unified",
        barmode: "relative", bargap: 0.15,
        shapes: [
          { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
            line: { color: "#6e7681", width: 1 } },
          ...lsm.shapes,
        ],
        annotations: lsm.annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s",
          title: { text: "Real Dollars" } },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const SubsidyConversionChart = React.memo(function SubsidyConversionChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  coverageEndAge?: number; birthYear?: number; height?: number;
}) {
  const ages = props.result.ages;
  const x = props.axisMode === "age" ? [...ages] : [...props.result.years];
  const convByAge = ages.map((age) =>
    props.result.ladder_schedule.filter((r) => r.age === age).reduce((s, r) => s + r.amount_real, 0));
  const sub = props.result.healthcare?.subsidy_real ?? [];
  const marks: LifeMark[] = [{ age: props.retirementAge, label: "Retire", color: "#d29922" }];
  if (props.coverageEndAge)
    marks.push({ age: props.coverageEndAge, label: `Medicare ${props.coverageEndAge}`, color: "#bc8cff" });
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend height={props.height}
      series={[
        { name: "Roth Conversions", values: convByAge, color: "#f0883e", fill: true },
        { name: "ACA Subsidy", values: sub, color: "#3fb950", fill: true },
      ]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, marks)}
      title="Conversions vs ACA Subsidy — The MAGI Trade-off, Today's $" />
  );
});

export const WealthFlowsChart = React.memo(function WealthFlowsChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const xPools = xValues(props.result, props.axisMode); // T+1 (carries "today")
  const pools = props.result.pool_medians_real ?? {};
  const poolKeys = POOL_ORDER.filter((k) => pools[k]?.some((v) => v > 1));
  const data: Data[] = poolKeys.map((k) => ({
    x: xPools, y: pools[k], type: "scatter" as const, mode: "lines" as const,
    stackgroup: "bal", name: POOL_LABELS[k],
    line: { width: 0.5, color: POOL_COLORS[k] }, fillcolor: POOL_COLORS[k] + "55",
    hovertemplate: "%{y:$,.0f}",
  }));
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 380, hovermode: "x unified",
        legend: { ...baseLayout.legend, traceorder: "reversed" },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero",
          title: { text: "Balance (Today's $)" } },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Account Balances By Pool — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});
