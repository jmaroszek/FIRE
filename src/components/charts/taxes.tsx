// Tax-strategy charts: traditional overfunding and the annual tax-rate view.
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


export const TradOverfundingChart = React.memo(function TradOverfundingChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; birthYear?: number; height?: number;
}) {
  const rmd = props.result.rmds_median_real ?? [];
  if (!rmd.length || rmd.every((v) => v < 1))
    return <p className="hint">No projected RMDs on the median path — your traditional
      balance is drained before 75 (the ladder defused it) or the horizon ends before then.</p>;
  const ages = props.result.ages;
  const spend = props.result.expenses_median_real;
  // RMDs only begin at 75, so that's where the story starts.
  let start = ages.findIndex((a) => a >= 75);
  if (start < 0) start = 0;
  const x = props.axisMode === "age"
    ? [...ages.slice(start)] : [...props.result.years.slice(start)];
  const rmdS = rmd.slice(start);
  const spendS = spend.slice(start);
  // Split each RMD bar at the spending line: the part you'd have spent anyway,
  // and the forced surplus stacked on top — ordinary income you must realize but
  // don't need. The spending line overlays so the split point stays legible.
  const withinSpend = rmdS.map((v, i) => Math.min(v, spendS[i] ?? 0));
  const surplus = rmdS.map((v, i) => Math.max(v - (spendS[i] ?? 0), 0));
  // Legend reads top-down: Spending, RMD Within Spending, Forced Surplus. Bars
  // still stack within-then-surplus regardless of where the line trace sits.
  const data: Data[] = [
    { x, y: spendS, type: "scatter", mode: "lines", name: "Spending",
      line: { color: ACCENT, width: 2 },
      hovertemplate: "Spending %{y:$,.0f}<extra></extra>" },
    { x, y: withinSpend, type: "bar", name: "RMD Within Spending",
      marker: { color: "rgba(210,153,34,0.55)" },
      hovertemplate: "Within spending %{y:$,.0f}<extra></extra>" },
    { x, y: surplus, type: "bar", name: "Forced Surplus",
      marker: { color: "rgba(248,81,73,0.75)" },
      hovertemplate: "Forced surplus %{y:$,.0f}<extra></extra>" },
  ];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 320, hovermode: "x unified", barmode: "stack",
        // extra bottom room so the x-axis title clears the (reversed) legend
        margin: { ...baseLayout.margin, b: 72 },
        // stacked charts default to a reversed legend; force normal order and centre it
        legend: { orientation: "h", y: -0.32, x: 0.5, xanchor: "center", traceorder: "normal" },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, dtick: 1,
          title: { text: props.axisMode === "age" ? "Age" : "Year", standoff: 8 } },
        title: { text: "Forced Withdrawals vs Spending — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const AnnualTaxRateChart = React.memo(function AnnualTaxRateChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  claimingAge?: number; birthYear?: number; height?: number;
}) {
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const marks: LifeMark[] = [
    { age: props.retirementAge, label: "Retire", color: "#d29922" },
    { age: 75, label: "RMD 75", color: "#8b949e" },
  ];
  if (props.claimingAge) marks.push({ age: props.claimingAge, label: "SS", color: "#56d364" });
  const lsm = lifeStageMarkers(props.axisMode, props.birthYear, marks);
  const data: Data[] = [
    { x, y: props.result.taxes_median_real, type: "bar", name: "Annual Tax ($)", yaxis: "y1",
      marker: { color: "rgba(88,166,255,0.45)" }, hovertemplate: "Tax %{y:$,.0f}<extra></extra>" },
    { x, y: props.result.marginal_rate_median ?? [], type: "scatter", mode: "lines",
      name: "Marginal Rate", yaxis: "y2", line: { color: "#f0883e", width: 2 },
      hovertemplate: "Marginal %{y:.1%}<extra></extra>" },
    { x, y: props.result.effective_rate_median ?? [], type: "scatter", mode: "lines",
      name: "Effective Rate", yaxis: "y2", line: { color: "#3fb950", width: 2 },
      hovertemplate: "Effective %{y:.1%}<extra></extra>" },
  ];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified",
        margin: { ...baseLayout.margin, r: 64 },
        shapes: lsm.shapes, annotations: lsm.annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero",
          title: { text: "Annual Tax" } },
        yaxis2: { tickformat: ".0%", overlaying: "y", side: "right", rangemode: "tozero",
          gridcolor: "transparent", automargin: true, title: { text: "Rate", standoff: 8 } },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});
