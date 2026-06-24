// Spending: actuals vs plan, preview, depth, fulfillment, healthcare cost.
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


const SPEND_PALETTE = [
  "#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72",
  "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#ffa657", "#8b949e", "#6e7681",
];

export const SpendingActualsChart = React.memo(function SpendingActualsChart(props: {
  snapshots: Snapshot[];
  categories: Category[];
  inflationMean: number;
  planTotal: number;
  height?: number;
}) {
  const snaps = props.snapshots.filter(
    (s) => s.spending && Object.values(s.spending).some((v) => v > 0));
  if (snaps.length === 0) return null;
  const nowYear = new Date().getFullYear();
  const deflate = (v: number, date: string) =>
    v * Math.pow(1 + props.inflationMean, nowYear - new Date(date).getFullYear());
  const x = snaps.map((s) => s.date);
  // current categories in display order, plus any retired slugs still in data
  const slugs = props.categories.map((c) => c.slug);
  for (const s of snaps) {
    for (const slug of Object.keys(s.spending ?? {})) {
      if (!slugs.includes(slug)) slugs.push(slug);
    }
  }
  const nameOf = (slug: string) =>
    props.categories.find((c) => c.slug === slug)?.name ?? slug;
  const data: Data[] = slugs
    .filter((slug) => snaps.some((s) => (s.spending?.[slug] ?? 0) > 0))
    .map((slug, i) => ({
      x,
      y: snaps.map((s) => deflate(s.spending?.[slug] ?? 0, s.date)),
      type: "bar" as const,
      name: nameOf(slug),
      marker: { color: SPEND_PALETTE[i % SPEND_PALETTE.length] },
      hovertemplate: `${nameOf(slug)}: %{y:$,.0f}<extra></extra>`,
    }));
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 360,
        barmode: "stack",
        bargap: 0.4,
        hovermode: "x unified",
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, type: "category" },
        shapes: props.planTotal > 0 ? [{
          type: "line", xref: "paper", x0: 0, x1: 1,
          y0: props.planTotal, y1: props.planTotal,
          line: { color: "#d29922", width: 1.5, dash: "dash" },
        }] : [],
        annotations: props.planTotal > 0 ? [{
          xref: "paper", x: 1, y: props.planTotal, xanchor: "right",
          yanchor: "bottom", showarrow: false,
          text: "Planned Expenses (Today's $)",
          font: { color: "#d29922", size: 11 },
        }] as Layout["annotations"] : [],
        title: { text: "Spending Actuals By Category — Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export function enjoymentFactor(age: number, goGoEnd = 75, floor = 0.3, taperEnd = 90): number {
  if (age <= goGoEnd) return 1;
  if (age >= taperEnd) return floor;
  return 1 - ((age - goGoEnd) / (taperEnd - goGoEnd)) * (1 - floor);
}

export const FulfillmentChart = React.memo(function FulfillmentChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  birthYear?: number; goGoEnd?: number; floor?: number; height?: number;
}) {
  const goGoEnd = props.goGoEnd ?? 75;
  const floor = props.floor ?? 0.3;
  const ages = props.result.ages;
  const x = props.axisMode === "age" ? [...ages] : [...props.result.years];
  const spend = props.result.expenses_median_real;
  const weighted = spend.map((v, i) => v * enjoymentFactor(ages[i], goGoEnd, floor));
  const retire = lifeStageMarkers(props.axisMode, props.birthYear,
    [{ age: props.retirementAge, label: "Retire", color: "#d29922" }]);
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend height={props.height}
      series={[
        { name: "Planned Spending", values: spend, color: ACCENT, fill: true },
        { name: "Enjoyment-Weighted", values: weighted, color: "#f0883e" },
      ]}
      markers={retire}
      title="" />
  );
});

export const SpendingDepthChart = React.memo(function SpendingDepthChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  enabled: boolean; floor: number; cap: number; birthYear?: number;
}) {
  if (!props.enabled)
    return (
      <p className="hint">
        Spending guardrails are off, so discretionary spending follows the plan exactly
        (a flat 100%). Enable Spending Guardrails on the Freedom tab to see how a bad
        market would flex spending year to year.
      </p>
    );
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const refs = [{ value: 1, label: "Plan (100%)", color: "#8b949e" }];
  if (props.floor > 0) refs.push({ value: props.floor, label: "Floor", color: "#8b949e" });
  if (props.cap > 1) refs.push({ value: props.cap, label: "Cap", color: "#8b949e" });
  const markers = lifeStageMarkers(props.axisMode, props.birthYear,
    [{ age: props.retirementAge, label: "Retire", color: "#d29922" }]);
  const shapes: Partial<Shape>[] = [...markers.shapes];
  const annotations: any[] = [...markers.annotations];
  for (const r of refs) {
    shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: r.value, y1: r.value,
      line: { color: r.color, width: 1, dash: "dot" } });
    annotations.push({ xref: "paper", x: 0, y: r.value, xanchor: "left", yanchor: "bottom",
      showarrow: false, text: r.label, font: { color: r.color, size: 10 } });
  }
  const fan = props.result.spending_mult_fan;
  // Matching-percentile funded spending in today's $, so the tooltip can show the
  // dollar lifestyle beside the "% of plan" at each percentile.
  const dollars = props.result.expenses_fan_real;
  const tip = (label: string, key: "p10" | "p25" | "p50") =>
    dollars?.[key]
      ? `${label}: %{y:.0%} · %{customdata:$,.0f}<extra></extra>`
      : `${label}: %{y:.0%}<extra></extra>`;
  // Realized spending is bounded above by the plan/cap, so the only story is the
  // DOWNSIDE — how far the bad paths cut. Show the median and the percentiles at or
  // below it (not a symmetric fan), which is what "how low can it go" actually asks.
  if (fan && fan.p50) {
    const data: Data[] = [
      // faint shading of the whole downside zone (10th pct up to the median)
      { x, y: fan.p10, type: "scatter", mode: "lines", line: { width: 0 },
        hoverinfo: "skip", showlegend: false },
      { x, y: fan.p50, type: "scatter", mode: "lines", fill: "tonexty",
        fillcolor: ACCENT + "10", line: { width: 0 }, hoverinfo: "skip", showlegend: false },
      { x, y: fan.p10, type: "scatter", mode: "lines", name: "10th percentile (worst)",
        line: { color: "#ff7b72", width: 1.5, dash: "dashdot" },
        customdata: dollars?.p10, hovertemplate: tip("10th pct", "p10") },
      { x, y: fan.p25, type: "scatter", mode: "lines", name: "25th percentile",
        line: { color: "#f0883e", width: 1.5, dash: "dash" },
        customdata: dollars?.p25, hovertemplate: tip("25th pct", "p25") },
      { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median (50th)",
        line: { color: ACCENT, width: 2 },
        customdata: dollars?.p50, hovertemplate: tip("Median", "p50") },
    ];
    return (
      <Plot
        data={data}
        layout={{
          ...baseLayout, height: 320, hovermode: "x unified",
          shapes, annotations: annotations as Layout["annotations"],
          yaxis: { ...baseLayout.yaxis, tickformat: ".0%",
            range: [0, Math.max(1, props.cap) * 1.02], autorange: false },
          xaxis: { ...baseLayout.xaxis,
            title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        }}
        config={config}
        style={{ width: "100%" }}
      />
    );
  }
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="percent"
      series={[{ name: "Discretionary vs Plan", values: props.result.spending_mult_median, color: ACCENT, fill: true }]}
      refLines={refs} markers={markers} title="" />
  );
});

export const SpendingPreviewChart = React.memo(function SpendingPreviewChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge: number; birthYear?: number; height?: number;
}) {
  const fan = props.result.expenses_fan_real;
  if (!fan || !fan.p50) return null;
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const markers = lifeStageMarkers(props.axisMode, props.birthYear,
    [{ age: props.retirementAge, label: "Retire", color: "#d29922" }]);
  const data: Data[] = [
    // faint shading of the downside zone (1-in-4 bad case, p25, up to the median)
    { x, y: fan.p25, type: "scatter", mode: "lines", line: { width: 0 },
      hoverinfo: "skip", showlegend: false },
    { x, y: fan.p50, type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: ACCENT + "12", line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x, y: fan.p25, type: "scatter", mode: "lines", name: "Worst 25%",
      line: { color: "#ff7b72", width: 1.5, dash: "dash" },
      hovertemplate: "Worst 25%: %{y:$,.0f}<extra></extra>" },
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: ACCENT, width: 2 },
      hovertemplate: "Median: %{y:$,.0f}<extra></extra>" },
  ];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 200, hovermode: "x unified",
        showlegend: false, margin: { l: 58, r: 16, t: 18, b: 36 },
        shapes: markers.shapes, annotations: markers.annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: "$.2~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis,
          title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const HealthcareCostChart = React.memo(function HealthcareCostChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  coverageEndAge?: number; birthYear?: number; height?: number;
}) {
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const net = props.result.healthcare?.net_cost_real ?? [];
  const sub = props.result.healthcare?.subsidy_real ?? [];
  const series: { name: string; values: number[]; color: string; fill?: boolean }[] = [];
  if (net.some((v) => v > 1))
    series.push({ name: "Net Cost (Premium − Subsidy + IRMAA)", values: net, color: "#bc8cff", fill: true });
  if (sub.some((v) => v > 1))
    series.push({ name: "ACA Subsidy", values: sub, color: "#3fb950", fill: false });
  const marks: LifeMark[] = [{ age: props.retirementAge, label: "Retire", color: "#d29922" }];
  if (props.coverageEndAge)
    marks.push({ age: props.coverageEndAge, label: `Medicare ${props.coverageEndAge}`, color: "#bc8cff" });
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend height={props.height}
      series={series}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, marks)}
      title="Net Healthcare Cost Over Life — Today's $" />
  );
});
