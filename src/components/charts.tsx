import React from "react";
import Plotly from "plotly.js-dist-min";
import type { Config, Data, Layout, Shape } from "plotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import type { CompareSlot } from "../store";
import type { SimulateResult, Snapshot, SweepResult } from "../types";

const Plot = createPlotlyComponent(Plotly);

const FG = "#c9d1d9";
const GRID = "#2d333b";
const ACCENT = "#58a6ff";

export const baseLayout: Partial<Layout> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: FG, size: 12 },
  margin: { l: 70, r: 20, t: 30, b: 45 },
  xaxis: { gridcolor: GRID, zeroline: false },
  yaxis: { gridcolor: GRID, zeroline: false },
  showlegend: true,
  legend: { orientation: "h", y: -0.18 },
};

const config: Partial<Config> = { displayModeBar: false, responsive: true };

function xValues(result: SimulateResult, axisMode: "age" | "year", extraPoint = true): number[] {
  const base = axisMode === "age" ? result.ages : result.years;
  // fan series have T+1 points ([0] = today); ages/years have T
  return extraPoint ? [base[0] - 1, ...base] : [...base];
}

export function FanChart(props: {
  result: SimulateResult;
  axisMode: "age" | "year";
  display: "real" | "nominal";
  retirementMarker?: number | null;
  snapshots?: Snapshot[];
  startYear?: number;
  birthYear?: number;
  height?: number;
  showTails?: boolean;
}) {
  const fan = props.result.fan[props.display];
  const x = xValues(props.result, props.axisMode);
  const band = (lo: string, hi: string, color: string, label: string): Data[] => [
    { x, y: fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x, y: fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: color, line: { width: 0 }, name: label, hovertemplate: "%{y:$,.0f}" },
  ];
  const data: Data[] = [
    ...(props.showTails ? band("p5", "p95", "rgba(88,166,255,0.13)", "5–95%") : []),
    ...band("p25", "p75", "rgba(88,166,255,0.22)", "25–75%"),
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: ACCENT, width: 2.5 }, hovertemplate: "%{y:$,.0f}" },
  ];
  if (props.snapshots?.length && props.startYear != null && props.birthYear != null) {
    const sx = props.snapshots.map((s) => {
      const year = new Date(s.date).getFullYear();
      return props.axisMode === "age" ? year - props.birthYear! : year;
    });
    const sy = props.snapshots.map((s) =>
      Object.values(s.balances).reduce((a, b) => a + b, 0));
    data.push({
      x: sx, y: sy, type: "scatter", mode: "markers", name: "Actuals",
      marker: { color: "#f0883e", size: 9, symbol: "diamond" },
      hovertemplate: "%{y:$,.0f}",
    });
  }
  const shapes: Partial<Shape>[] = [];
  const annotations: Partial<Layout["annotations"][number]>[] = [];
  if (props.retirementMarker != null) {
    shapes.push({
      type: "line", x0: props.retirementMarker, x1: props.retirementMarker,
      y0: 0, y1: 1, yref: "paper",
      line: { color: "#d29922", width: 1.5, dash: "dash" },
    });
    annotations.push({
      x: props.retirementMarker, y: 1, yref: "paper",
      text: `Retire ${props.retirementMarker}`, showarrow: false,
      yanchor: "bottom", font: { color: "#d29922", size: 11 },
    });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, shapes, annotations: annotations as Layout["annotations"],
        height: props.height ?? 420,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: `Net Worth (${props.display === "real" ? "Today's" : "Nominal"} $)`, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

export function SweepChart(props: {
  sweep: SweepResult; axisMode: "age" | "year";
  birthYear: number; height?: number;
}) {
  const ages = Object.keys(props.sweep.sweep).map(Number).sort((a, b) => a - b);
  const x = props.axisMode === "age" ? ages : ages.map((a) => a + props.birthYear);
  const y = ages.map((a) => props.sweep.sweep[String(a)]);
  return (
    <Plot
      data={[
        { x, y, type: "scatter", mode: "lines+markers", name: "Success probability",
          line: { color: "#3fb950", width: 2.5 }, hovertemplate: "%{y:.1%}" },
      ]}
      layout={{
        ...baseLayout,
        height: props.height ?? 320,
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [0, 1.02] },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        shapes: [{
          type: "line", x0: x[0], x1: x[x.length - 1],
          y0: props.sweep.threshold, y1: props.sweep.threshold,
          line: { color: "#d29922", width: 1, dash: "dot" },
        }],
        title: { text: "Success Probability vs Retirement Age", font: { size: 14 } },
        showlegend: false,
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

const SOURCE_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  roth_basis: "Roth contributions",
  roth_matured_conversions: "Matured conversions",
  trad: "Traditional (59½+)",
  hsa: "HSA (65+)",
  roth_earnings: "Roth earnings (59½+)",
};
const SOURCE_COLORS: Record<string, string> = {
  cash: "#8b949e",
  taxable: "#58a6ff",
  roth_basis: "#3fb950",
  roth_matured_conversions: "#2ea043",
  trad: "#d29922",
  hsa: "#bc8cff",
  roth_earnings: "#56d364",
};

export function AccessibilityChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const order = ["cash", "taxable", "roth_basis", "roth_matured_conversions",
                 "trad", "hsa", "roth_earnings"];
  const data: Data[] = order
    .filter((src) => props.result.accessibility_real[src])
    .map((src) => ({
      x: [...x],
      y: props.result.accessibility_real[src],
      type: "scatter" as const,
      mode: "lines" as const,
      stackgroup: "one",
      name: SOURCE_LABELS[src] ?? src,
      line: { width: 0.5, color: SOURCE_COLORS[src] },
      fillcolor: SOURCE_COLORS[src] + "66",
      hovertemplate: "%{y:$,.0f}",
    }));
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 400,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Accessible (Penalty-Free) Assets By Source — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

export function CompareChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; display: "real" | "nominal"; height?: number;
}) {
  const palette = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72"];
  const data: Data[] = [];
  props.slots.forEach((slot, i) => {
    const color = palette[i % palette.length];
    const x = xValues(slot.result, props.axisMode);
    const fan = slot.result.fan[props.display];
    data.push(
      { x, y: fan.p25, type: "scatter", mode: "lines", line: { width: 0 },
        hoverinfo: "skip", showlegend: false },
      { x, y: fan.p75, type: "scatter", mode: "lines", fill: "tonexty",
        fillcolor: color + "22", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
      { x, y: fan.p50, type: "scatter", mode: "lines", name: slot.name,
        line: { color, width: 2.5 }, hovertemplate: "%{y:$,.0f}" },
    );
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 460,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: `Median Net Worth With 25–75% Bands (${props.display === "real" ? "Today's" : "Nominal"} $)`, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

export function CompareSweepChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
}) {
  const palette = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72"];
  const data: Data[] = [];
  let threshold: number | null = null;
  props.slots.forEach((slot, i) => {
    if (!slot.sweep) return;
    threshold = threshold ?? slot.sweep.threshold;
    const ages = Object.keys(slot.sweep.sweep).map(Number).sort((a, b) => a - b);
    const x = props.axisMode === "age"
      ? ages : ages.map((a) => a + slot.scenario.profile.birth_year);
    data.push({
      x,
      y: ages.map((a) => slot.sweep!.sweep[String(a)]),
      type: "scatter", mode: "lines",
      name: slot.name,
      line: { color: palette[i % palette.length], width: 2.5 },
      hovertemplate: "%{y:.1%}",
    });
  });
  if (data.length === 0) return null;
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 340,
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [0, 1.02] },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        shapes: threshold != null ? [{
          type: "line", xref: "paper", x0: 0, x1: 1,
          y0: threshold, y1: threshold,
          line: { color: "#d29922", width: 1, dash: "dot" },
        }] : [],
        title: { text: "Success Probability vs Retirement Age", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}
