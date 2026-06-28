// Generic reusable chart primitives: single/multi-series line/area and percentile fan.
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


export const SeriesChart = React.memo(function SeriesChart(props: {
  x: number[]; axisMode: "age" | "year"; yFormat: YFmt; title: string;
  series: { name: string; values: number[]; color: string; fill?: boolean }[];
  markers?: { shapes: Partial<Shape>[]; annotations: any[] };
  refLines?: { value: number; label: string; color?: string }[];
  height?: number; legend?: boolean;
  /** Omit the x-axis title so a bottom legend can't overlap it. */
  hideXTitle?: boolean;
}) {
  const data: Data[] = props.series.map((s) => ({
    x: props.x, y: s.values, type: "scatter", mode: "lines", name: s.name,
    line: { color: s.color, width: 2 },
    fill: s.fill ? "tozeroy" : undefined,
    fillcolor: s.fill ? s.color + "22" : undefined,
    hovertemplate: `${s.name}: ${yHover(props.yFormat)}<extra></extra>`,
  } as Data));
  const shapes: Partial<Shape>[] = [...(props.markers?.shapes ?? [])];
  const annotations: any[] = [...(props.markers?.annotations ?? [])];
  for (const r of props.refLines ?? []) {
    shapes.push({
      type: "line", xref: "paper", x0: 0, x1: 1, y0: r.value, y1: r.value,
      line: { color: r.color ?? "#8b949e", width: 1, dash: "dot" },
    });
    annotations.push({
      xref: "paper", x: 0, y: r.value, xanchor: "left", yanchor: "bottom",
      showarrow: false, text: r.label, font: { color: r.color ?? "#8b949e", size: 10 },
    });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 320, hovermode: "x unified",
        showlegend: props.legend ?? props.series.length > 1,
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: {
          ...baseLayout.yaxis, tickformat: yTick(props.yFormat),
          ticksuffix: props.yFormat === "multiplier" ? "×" : undefined,
          rangemode: "tozero",
        },
        xaxis: { ...baseLayout.xaxis,
          title: props.hideXTitle ? undefined : { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const PercentileFanChart = React.memo(function PercentileFanChart(props: {
  x: number[]; fan: FanSeries; axisMode: "age" | "year"; yFormat: YFmt; title: string;
  color?: string; markers?: { shapes: Partial<Shape>[]; annotations: any[] };
  refLines?: { value: number; label: string; color?: string }[]; height?: number;
  yRange?: [number, number];
  /** Drop the wide outer (5–95%) band — keeps the y-axis tight on the bulk of paths. */
  showOuterBand?: boolean;
  /** Omit the x-axis title (frees the bottom margin so the legend can't overlap it). */
  hideXTitle?: boolean;
}) {
  const c = props.color ?? ACCENT;
  const band = (lo: string, hi: string, alpha: string, label: string): Data[] => [
    { x: props.x, y: props.fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x: props.x, y: props.fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: c + alpha, line: { width: 0 }, name: label, hoverinfo: "skip" },
  ];
  const data: Data[] = [
    ...(props.showOuterBand === false ? [] : band("p5", "p95", "12", "5–95% Of Paths")),
    ...band("p25", "p75", "24", "25–75% Of Paths"),
    { x: props.x, y: props.fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: c, width: 2 }, hovertemplate: `${yHover(props.yFormat)}<extra></extra>` },
  ];
  const shapes: Partial<Shape>[] = [...(props.markers?.shapes ?? [])];
  const annotations: any[] = [...(props.markers?.annotations ?? [])];
  for (const r of props.refLines ?? []) {
    shapes.push({
      type: "line", xref: "paper", x0: 0, x1: 1, y0: r.value, y1: r.value,
      line: { color: r.color ?? "#8b949e", width: 1, dash: "dot" },
    });
    annotations.push({
      xref: "paper", x: 0, y: r.value, xanchor: "left", yanchor: "bottom",
      showarrow: false, text: r.label, font: { color: r.color ?? "#8b949e", size: 10 },
    });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 320, showlegend: true,
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: {
          ...baseLayout.yaxis, tickformat: yTick(props.yFormat),
          ticksuffix: props.yFormat === "multiplier" ? "×" : undefined,
          ...(props.yRange ? { range: props.yRange, autorange: false } : {}),
        },
        xaxis: { ...baseLayout.xaxis, showspikes: false,
          title: props.hideXTitle ? undefined : { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});
