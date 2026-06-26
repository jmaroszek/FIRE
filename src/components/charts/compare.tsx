// Cross-scenario comparison charts. Every series is colored by its slot's stable
// color (assigned at pin time, see COMPARE_PALETTE) so a scenario keeps the same
// hue across every chart here and the legend chips on the Compare tab.
//
// All charts accept an optional `focusId`: when set, the matching scenario is held
// at full strength and the rest dim, so clicking a chip spotlights one plan across
// every view at once.
import React from "react";
import type { Data, Layout, Shape } from "plotly.js";
import type { CompareSlot } from "../../store";
import { percentile } from "../../math";
import { Plot, baseLayout, config, xValues } from "../chartShared";
import { enjoymentFactor } from "./spending";

// Dark, themed hover label — matches the Freedom tornado, never the bright default.
const HOVERLABEL = { bgcolor: "#1c2128", bordercolor: "#2d333b", font: { color: "#c9d1d9", size: 12 } };

/** Line weight + opacity for a slot given the focused scenario (null = no focus). */
function emphasis(slot: CompareSlot, focusId: string | null | undefined): { width: number; opacity: number } {
  if (!focusId) return { width: 2.5, opacity: 1 };
  return slot.id === focusId ? { width: 3.25, opacity: 1 } : { width: 2, opacity: 0.16 };
}

/** Bar fill for a slot under focus: non-focused bars fade via an alpha suffix. */
function barColor(slot: CompareSlot, focusId: string | null | undefined): string {
  return !focusId || slot.id === focusId ? slot.color : slot.color + "33";
}

/** Numeric years-to-FI for a slot: the earliest swept retirement age clearing the
 *  success threshold, minus the start age. null while the sweep is pending or if
 *  no age through 70 clears it. Shared with the Compare table's string formatter. */
export function yearsToFiNum(slot: CompareSlot): number | null {
  if (!slot.sweep) return null;
  const startAge = slot.scenario.sim.start_year - slot.scenario.profile.birth_year;
  const ages = Object.keys(slot.sweep.sweep).map(Number).sort((a, b) => a - b);
  for (const a of ages) if (slot.sweep.sweep[String(a)] >= slot.sweep.threshold) return a - startAge;
  return null;
}

/** Share of each ending-outcome sample at or below every point of a shared dollar
 *  grid — so all scenarios' CDFs sit on one x axis and a unified hover can read
 *  each one's percentile at the hovered net-worth level. */
function cdfOnGrid(values: number[], grid: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return grid.map((x) => {
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] <= x) lo = mid + 1; else hi = mid; }
    return s.length ? lo / s.length : 0;
  });
}

type FocusProp = { focusId?: string | null };

// Median trajectories only — overlapping translucent fans turn to mud past two or
// three scenarios, so the spread lives in the ending-distribution chart instead.
export const CompareChart = React.memo(function CompareChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
} & FocusProp) {
  const data: Data[] = props.slots.map((slot) => {
    const e = emphasis(slot, props.focusId);
    return {
      x: xValues(slot.result, props.axisMode), y: slot.result.fan.real.p50,
      type: "scatter", mode: "lines", name: slot.name, opacity: e.opacity,
      line: { color: slot.color, width: e.width }, hovertemplate: "%{y:$,.0f}<extra></extra>",
    } as Data;
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 420, hovermode: "x unified", hoverlabel: HOVERLABEL,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

// "Will the money last?" — % of Monte Carlo paths still funded at each age, one
// line per scenario. Mirrors the Freedom survival curve; reads cleanly at any count.
export const CompareSurvivalChart = React.memo(function CompareSurvivalChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
} & FocusProp) {
  const data: Data[] = props.slots.map((slot) => {
    const e = emphasis(slot, props.focusId);
    return {
      x: props.axisMode === "age" ? slot.result.ages : slot.result.years,
      y: slot.result.survival_curve, type: "scatter", mode: "lines", name: slot.name, opacity: e.opacity,
      line: { color: slot.color, width: e.width }, hovertemplate: "%{y:.0%}<extra></extra>",
    } as Data;
  });
  const threshold = props.slots[0]?.scenario.sim.success_threshold ?? null;
  const shapes: Partial<Shape>[] = threshold != null ? [{
    type: "line", xref: "paper", x0: 0, x1: 1, y0: threshold, y1: threshold,
    line: { color: "#d29922", width: 1, dash: "dot" },
  }] : [];
  const annotations = threshold != null ? [{
    xref: "paper" as const, x: 0, y: threshold, xanchor: "left" as const, yanchor: "bottom" as const,
    showarrow: false, text: "Success Threshold", font: { color: "#d29922", size: 10 },
  }] : [];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified", hoverlabel: HOVERLABEL,
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [0, 1.02] },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

// Ending net worth as overlaid cumulative-distribution lines on a shared dollar
// grid: a unified hover reads "what fraction of paths end at or below $X" for every
// scenario at once, and dots mark each scenario's p10 / p50 / p90 so downside,
// median and upside compare at a glance.
export const CompareEndingDistChart = React.memo(function CompareEndingDistChart(props: {
  slots: CompareSlot[]; height?: number;
} & FocusProp) {
  // A single lucky path can run the upside out to many multiples of the median,
  // squashing the decision-relevant left half. Crop the axis to the widest 98th
  // percentile across scenarios so the bulk of each distribution stays legible.
  const xMax = Math.max(0, ...props.slots.map((s) => percentile(s.result.ending_balance.real, 98)));
  const N = 140;
  const grid = Array.from({ length: N + 1 }, (_, i) => (i / N) * xMax);
  const data: Data[] = [];
  props.slots.forEach((slot) => {
    const e = emphasis(slot, props.focusId);
    const vals = slot.result.ending_balance.real;
    data.push({
      x: grid, y: cdfOnGrid(vals, grid), type: "scatter", mode: "lines", name: slot.name,
      opacity: e.opacity, line: { color: slot.color, width: e.width },
      hovertemplate: "%{y:.0%} at or below<extra></extra>",
    } as Data);
    // p10 / p50 / p90 reference dots — fixed-confidence anchors on each curve.
    data.push({
      x: [percentile(vals, 10), percentile(vals, 50), percentile(vals, 90)],
      y: [0.1, 0.5, 0.9], type: "scatter", mode: "markers", showlegend: false,
      opacity: e.opacity, marker: { color: slot.color, size: 7, line: { color: "#0d1117", width: 1 } },
      customdata: ["p10", "p50", "p90"],
      hovertemplate: `${slot.name} %{customdata}: %{x:$,.0f}<extra></extra>`,
    } as Data);
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 360, hovermode: "x unified", hoverlabel: HOVERLABEL,
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [0, 1], title: { text: "Share Of Paths At Or Below" } },
        xaxis: { ...baseLayout.xaxis, tickformat: "$.3~s", rangemode: "tozero",
          ...(xMax > 0 ? { range: [0, xMax], autorange: false } : {}),
          title: { text: "Real Ending Net Worth" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const CompareSweepChart = React.memo(function CompareSweepChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
} & FocusProp) {
  const data: Data[] = [];
  let threshold: number | null = null;
  props.slots.forEach((slot) => {
    if (!slot.sweep) return;
    threshold = threshold ?? slot.sweep.threshold;
    const e = emphasis(slot, props.focusId);
    const ages = Object.keys(slot.sweep.sweep).map(Number).sort((a, b) => a - b);
    const x = props.axisMode === "age"
      ? ages : ages.map((a) => a + slot.scenario.profile.birth_year);
    data.push({
      x,
      y: ages.map((a) => slot.sweep!.sweep[String(a)]),
      type: "scatter", mode: "lines", name: slot.name, opacity: e.opacity,
      line: { color: slot.color, width: e.width },
      hovertemplate: "%{y:.1%}<extra></extra>",
    });
  });
  if (data.length === 0) return null;
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 340, hovermode: "x unified", hoverlabel: HOVERLABEL,
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [0, 1.02] },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        shapes: threshold != null ? [{
          type: "line", xref: "paper", x0: 0, x1: 1,
          y0: threshold, y1: threshold,
          line: { color: "#d29922", width: 1, dash: "dot" },
        }] : [],
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

// Enjoyment-weighted spending: median real spending re-weighted by the same
// fade-with-age factor the Freedom fulfillment view uses (full to 75, tapering to
// 30% by 90). A higher, more front-loaded line means more money lands while you can
// enjoy it — the early-spending-vs-oversaver signal, scenario by scenario.
export const CompareSatisfactionChart = React.memo(function CompareSatisfactionChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
} & FocusProp) {
  const data: Data[] = props.slots.map((slot) => {
    const e = emphasis(slot, props.focusId);
    const ages = slot.result.ages;
    const x = props.axisMode === "age" ? [...ages] : [...slot.result.years];
    const spend = slot.result.expenses_median_real;
    return {
      x, y: spend.map((v, i) => v * enjoymentFactor(ages[i])),
      type: "scatter", mode: "lines", name: slot.name, opacity: e.opacity,
      line: { color: slot.color, width: e.width }, hovertemplate: "%{y:$,.0f}<extra></extra>",
    } as Data;
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified", hoverlabel: HOVERLABEL,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const CompareBridgeChart = React.memo(function CompareBridgeChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
} & FocusProp) {
  const data: Data[] = [];
  let minRetire = Infinity;
  let ymax = 0;
  const firstBirth = props.slots[0]?.scenario.profile.birth_year ?? 0;
  props.slots.forEach((slot) => {
    const fan = slot.result.accessibility_fan;
    if (!fan || !fan.p50) return;
    const e = emphasis(slot, props.focusId);
    const ages = slot.result.ages;
    // This view is about the bridge only, so end at 59 — drawing through age 60
    // (when the locked accounts open) adds a large jump that's out of scope. Trim
    // the data, not just the axis, so no line segment reaches toward the 60 point.
    const x: number[] = [], y: number[] = [];
    for (let k = 0; k < ages.length; k++) {
      if (ages[k] > 59) continue;
      x.push(props.axisMode === "age" ? ages[k] : slot.result.years[k]);
      y.push(fan.p50[k] ?? 0);
    }
    data.push({
      x, y, type: "scatter", mode: "lines", name: slot.name, opacity: e.opacity,
      line: { color: slot.color, width: e.width },
      hovertemplate: "%{y:$,.0f}<extra></extra>",
    });
    const ra = slot.scenario.retirement_age;
    minRetire = Math.min(minRetire, ra);
    for (let k = 0; k < ages.length; k++)
      if (ages[k] >= ra - 1 && ages[k] <= 59) ymax = Math.max(ymax, fan.p50[k] ?? 0);
  });
  if (data.length === 0) return null;
  const off = props.axisMode === "age" ? 0 : firstBirth;
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified", hoverlabel: HOVERLABEL,
        yaxis: {
          ...baseLayout.yaxis, tickformat: "$.3~s",
          ...(ymax > 0 ? { range: [0, ymax * 1.12], autorange: false } : { rangemode: "tozero" }),
        },
        xaxis: {
          ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" },
          range: [minRetire - 3 + off, 59 + off],
        },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

// One compact horizontal-bar chart per headline metric, scenarios sharing their
// stable colors. Missing values (e.g. a pending sweep) simply leave that bar out.
const MetricBars = React.memo(function MetricBars(props: {
  slots: CompareSlot[]; title: string;
  values: (number | null)[]; tickformat: string; hover: string;
} & FocusProp) {
  return (
    <Plot
      data={[{
        type: "bar", orientation: "h",
        x: props.values, y: props.slots.map((s) => s.name),
        marker: { color: props.slots.map((s) => barColor(s, props.focusId)) },
        hovertemplate: `%{x:${props.hover}}<extra>%{y}</extra>`,
      } as Data]}
      layout={{
        ...baseLayout, height: 54 + props.slots.length * 30, showlegend: false,
        hovermode: "closest", hoverlabel: HOVERLABEL, margin: { l: 8, r: 14, t: 28, b: 26 },
        xaxis: { ...baseLayout.xaxis, showspikes: false, tickformat: props.tickformat, rangemode: "tozero" },
        yaxis: { ...baseLayout.yaxis, automargin: true, autorange: "reversed" },
        title: { text: props.title, font: { size: 13 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

// Headline scorecard: four always-available metrics as small bar charts, for an
// at-a-glance ranking that complements the precise numbers in the table.
export const CompareScorecard = React.memo(function CompareScorecard(props: { slots: CompareSlot[] } & FocusProp) {
  const last = (slot: CompareSlot, key: "p50" | "p25") => {
    const arr = slot.result.fan.real[key];
    return arr.length ? arr[arr.length - 1] : null;
  };
  return (
    <div className="compare-scorecard">
      <MetricBars slots={props.slots} focusId={props.focusId} title="Success Probability"
        values={props.slots.map((s) => s.result.success_rate)} tickformat=".0%" hover=".0%" />
      <MetricBars slots={props.slots} focusId={props.focusId} title="Years To FI"
        values={props.slots.map(yearsToFiNum)} tickformat="d" hover=".0f" />
      <MetricBars slots={props.slots} focusId={props.focusId} title="Median Ending Net Worth (Real)"
        values={props.slots.map((s) => last(s, "p50"))} tickformat="$.2s" hover="$,.0f" />
      <MetricBars slots={props.slots} focusId={props.focusId} title="Lifetime Tax (Median, Real)"
        values={props.slots.map((s) => s.result.lifetime_tax?.median_real ?? null)} tickformat="$.2s" hover="$,.0f" />
    </div>
  );
});
