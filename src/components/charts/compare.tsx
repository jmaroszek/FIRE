// Cross-scenario comparison charts.
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


export const CompareChart = React.memo(function CompareChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
}) {
  const palette = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72"];
  const data: Data[] = [];
  props.slots.forEach((slot, i) => {
    const color = palette[i % palette.length];
    const x = xValues(slot.result, props.axisMode);
    const fan = slot.result.fan.real;
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
        title: { text: "Median Net Worth With 25–75% Bands (Today's $)", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const CompareSweepChart = React.memo(function CompareSweepChart(props: {
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
});

export const CompareBridgeChart = React.memo(function CompareBridgeChart(props: {
  slots: CompareSlot[]; axisMode: "age" | "year"; height?: number;
}) {
  const palette = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72"];
  const data: Data[] = [];
  let minRetire = Infinity;
  let ymax = 0;
  const firstBirth = props.slots[0]?.scenario.profile.birth_year ?? 0;
  props.slots.forEach((slot, i) => {
    const fan = slot.result.accessibility_fan;
    if (!fan || !fan.p50) return;
    const ages = slot.result.ages;
    const x = props.axisMode === "age" ? [...ages] : [...slot.result.years];
    data.push({
      x, y: fan.p50, type: "scatter", mode: "lines", name: slot.name,
      line: { color: palette[i % palette.length], width: 2.5 },
      hovertemplate: "%{y:$,.0f}",
    });
    const ra = slot.scenario.retirement_age;
    minRetire = Math.min(minRetire, ra);
    for (let k = 0; k < ages.length; k++)
      if (ages[k] >= ra - 1 && ages[k] < 60) ymax = Math.max(ymax, fan.p50[k] ?? 0);
  });
  if (data.length === 0) return null;
  const off = props.axisMode === "age" ? 0 : firstBirth;
  const pf = 59.5 + off;
  const shapes: Partial<Shape>[] = [{
    type: "line", x0: pf, x1: pf, y0: 0, y1: 1, yref: "paper",
    line: { color: "#f0883e", width: 1.5, dash: "dash" },
  }];
  const annotations = [{
    x: pf, y: 1, yref: "paper" as const, yanchor: "bottom" as const,
    text: "59½", showarrow: false, font: { color: "#f0883e", size: 11 },
  }];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified",
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: {
          ...baseLayout.yaxis, tickformat: "$.3~s",
          ...(ymax > 0 ? { range: [0, ymax * 1.12], autorange: false } : { rangemode: "tozero" }),
        },
        xaxis: {
          ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" },
          range: [minRetire - 3 + off, 65 + off],
        },
        title: { text: "Median Penalty-Free Assets Through The Bridge (Today's $)", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});
