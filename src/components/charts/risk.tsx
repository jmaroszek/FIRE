// Outcome distributions and robustness: histograms, ruin age, surface, tornado, survival.
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


type HistUnit = "money" | "percent" | "years" | "number";

const histTickFormat = (u: HistUnit): string | undefined =>
  u === "money" ? "$.3~s" : u === "percent" ? ".0%" : undefined;

export const HistogramChart = React.memo(function HistogramChart(props: {
  values: number[];
  title: string;
  xTitle: string;
  unit?: HistUnit;
  color?: string;
  markers?: { value: number; label: string; color?: string }[];
  uirevision?: string;
  height?: number;
  // Fixed binning instead of auto (e.g. 50k buckets to 500k). When set with
  // clampOverflow, values at/above `end` are folded into the final bin so a long
  // tail becomes a single "end+" bucket rather than stretching the axis.
  bins?: { start: number; size: number; end: number };
  clampOverflow?: boolean;
}) {
  const unit = props.unit ?? "money";
  const color = props.color ?? "rgba(88,166,255,0.55)";
  const bins = props.bins;
  const values = bins && props.clampOverflow
    ? props.values.map((v) => Math.min(v, bins.end - bins.size / 2))
    : props.values;
  const markers = props.markers ?? [{ value: median(props.values), label: "Median", color: ACCENT }];
  const hoverX = unit === "money" ? "%{x:$,.0f}" : unit === "percent" ? "%{x:.0%}" : "%{x:,.0f}";
  const shapes: Partial<Shape>[] = markers
    .filter((mk) => !bins || (mk.value >= bins.start && mk.value <= bins.end))
    .map((mk) => ({
      type: "line", x0: mk.value, x1: mk.value, y0: 0, y1: 1, yref: "paper",
      line: { color: mk.color ?? ACCENT, width: 1.5, dash: "dash" },
    }));
  const annotations = markers
    .filter((mk) => !bins || (mk.value >= bins.start && mk.value <= bins.end))
    .map((mk) => ({
      x: mk.value, y: 1, yref: "paper" as const, yanchor: "bottom" as const,
      text: mk.label, showarrow: false, font: { color: mk.color ?? ACCENT, size: 11 },
    })) as any[];
  // Label the clamped overflow bin so the final bar reads as "everything ≥ end",
  // not as a literal value at `end` (the histogram's silent-truncation trap).
  if (bins && props.clampOverflow) {
    const compact = unit === "money"
      ? new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(bins.end)
      : unit === "percent" ? `${Math.round(bins.end * 100)}%` : `${bins.end}`;
    annotations.push({
      x: bins.end - bins.size / 2, y: 1, yref: "paper" as const, yanchor: "bottom" as const,
      xanchor: "center" as const, text: `${compact}+`, showarrow: false,
      font: { color: "#8b949e", size: 10 },
    });
  }
  return (
    <Plot
      data={[{
        x: values, type: "histogram",
        ...(bins
          ? { xbins: { start: bins.start, end: bins.end, size: bins.size }, autobinx: false }
          : { nbinsx: 40 }),
        marker: { color, line: { color: "#1c2128", width: 0.5 } },
        hovertemplate: `${hoverX}<br>%{y} paths<extra></extra>`,
      } as Data]}
      layout={{
        ...baseLayout, height: props.height ?? 300, showlegend: false, bargap: 0.02,
        hovermode: "x", uirevision: props.uirevision ?? props.title,
        shapes, annotations: annotations as Layout["annotations"],
        xaxis: {
          ...baseLayout.xaxis, tickformat: histTickFormat(unit),
          title: { text: props.xTitle },
          ...(bins ? { range: [bins.start, bins.end] } : {}),
        },
        yaxis: { ...baseLayout.yaxis, title: { text: "Paths" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const RuinAgeChart = React.memo(function RuinAgeChart(props: {
  data: SimulateResult["age_at_ruin"]; height?: number;
}) {
  const { ages, counts } = props.data;
  if (!ages.length) {
    return (
      <p className="hint">
        No path ran short — every Monte Carlo path funded spending through the horizon.
      </p>
    );
  }
  // Cumulative paths failed at or before each age — the running total behind the
  // survival curve, surfaced on hover beside the per-age count.
  let running = 0;
  const cumulative = counts.map((c) => (running += c));
  return (
    <Plot
      data={[{
        x: ages, y: counts, type: "bar",
        marker: { color: "#ff7b72" },
        customdata: cumulative,
        hovertemplate: "Age %{x}<br>%{y} paths fail here<br>%{customdata} failed by this age<extra></extra>",
      }]}
      layout={{
        ...baseLayout, height: props.height ?? 300, showlegend: false, hovermode: "x",
        xaxis: { ...baseLayout.xaxis, title: { text: "Age At First Shortfall" } },
        yaxis: { ...baseLayout.yaxis, title: { text: "Paths" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const SurfaceHeatmap = React.memo(function SurfaceHeatmap(props: {
  data: SurfaceResult; axisMode: "age" | "year"; birthYear: number;
  currentAge?: number | null; height?: number;
}) {
  const { ages, spending_scales, matrix, threshold } = props.data;
  const x = props.axisMode === "age" ? ages : ages.map((a) => a + props.birthYear);
  const y = spending_scales.map((s) => Math.round(s * 100));
  const data: Data[] = [
    {
      x, y, z: matrix, type: "heatmap",
      zmin: 0, zmax: 1,
      colorscale: [[0, "#7d1f1f"], [Math.max(0.01, Math.min(0.99, threshold)), "#d29922"], [1, "#2ea043"]],
      colorbar: { tickformat: ".0%", title: { text: "Success", side: "right" } },
      hovertemplate: `Retire %{x} · spend %{y}% of plan<br>%{z:.0%} success<extra></extra>`,
    } as Data,
    // (No drawn threshold contour — the colour transition at your success target
    // already marks the frontier, and the off-theme white iso-line read as a
    // stray vertical bar. Hover any cell to read its exact success rate.)
  ];
  // No drawn position marker — read your spot by hovering. (The old "You Are
  // Here" crosshair was the off-theme vertical bar the user flagged.)
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 360, showlegend: false,
        xaxis: { ...baseLayout.xaxis, showspikes: false, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        yaxis: { ...baseLayout.yaxis, title: { text: "Spending (% Of Plan)" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const TornadoChart = React.memo(function TornadoChart(props: { data: SensitivityResult; height?: number }) {
  const { entries, base_success } = props.data;
  if (!entries.length) return <p className="hint">No sensitivity data.</p>;
  const rows = [...entries].reverse(); // Plotly stacks horizontal bars bottom-up
  const labels = rows.map((e) => e.param);
  const bases = rows.map((e) => Math.min(e.low_success, e.high_success));
  const widths = rows.map((e) => Math.abs(e.high_success - e.low_success));
  const customdata = rows.map((e) => [e.low_label, e.low_success, e.high_label, e.high_success]);
  return (
    <Plot
      data={[{
        type: "bar", orientation: "h", y: labels, x: widths, base: bases,
        marker: { color: "rgba(88,166,255,0.7)", line: { color: ACCENT, width: 1 } },
        customdata,
        hovertemplate:
          "%{customdata[0]}: %{customdata[1]:.1%}<br>%{customdata[2]}: %{customdata[3]:.1%}<extra>%{y}</extra>",
      } as Data]}
      layout={{
        ...baseLayout, height: props.height ?? 40 + rows.length * 38, showlegend: false,
        hovermode: "closest",
        shapes: [{
          type: "line", x0: base_success, x1: base_success, y0: -0.5, y1: rows.length - 0.5,
          line: { color: "#8b949e", width: 1.5, dash: "dash" },
        }],
        annotations: [{
          x: base_success, y: rows.length - 0.5, yanchor: "bottom", text: "base",
          showarrow: false, font: { color: "#8b949e", size: 11 },
        }] as Layout["annotations"],
        xaxis: { ...baseLayout.xaxis, showspikes: false, tickformat: ".0%", range: [0, 1], title: { text: "Success Rate (input ±10%, retire age ±2 yr)" } },
        yaxis: { ...baseLayout.yaxis, automargin: true },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const SurvivalChart = React.memo(function SurvivalChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge: number; threshold?: number; birthYear?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="percent"
      series={[{ name: "Still Funded", values: props.result.survival_curve, color: "#3fb950", fill: true }]}
      refLines={props.threshold != null ? [{ value: props.threshold, label: "Success Threshold", color: "#d29922" }] : []}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.retirementAge, label: "Retire", color: "#d29922" }])}
      title="" />
  );
});
