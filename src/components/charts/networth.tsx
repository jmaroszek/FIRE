// Net-worth fan and retirement-age decision charts.
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


export const FanChart = React.memo(function FanChart(props: {
  result: SimulateResult;
  axisMode: "age" | "year";
  display: "real" | "nominal";
  retirementMarker?: number | null;
  snapshots?: Snapshot[];
  startYear?: number;
  birthYear?: number;
  glidepathToZero?: boolean;
  height?: number;
}) {
  const fan = props.result.fan[props.display];
  const x = xValues(props.result, props.axisMode);
  const gdRef = useRef<any>(null);
  const [tip, setTip] = useState<{
    px: number; py: number; flip: boolean;
    dollars: string; where: string; pct: string | null; median: string;
  } | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const gd = gdRef.current;
    const xa = gd?._fullLayout?.xaxis;
    const ya = gd?._fullLayout?.yaxis;
    if (!xa || !ya) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dataX = xa.p2d(px - xa._offset);
    const dataY = ya.p2d(py - ya._offset);
    const i = Math.round(dataX) - x[0];
    if (i < 0 || i >= x.length || dataY == null || !isFinite(dataY) || dataY < 0) {
      setTip(null);
      return;
    }
    setTip({
      px, py, flip: px > rect.width - 220,
      dollars: fmtTipMoney(Math.max(0, dataY)),
      where: `${props.axisMode === "age" ? "Age" : "Year"} ${x[0] + i}`,
      pct: percentileAt(fan, i, dataY),
      median: fmtTipMoney(fan.p50[i]),
    });
  };

  const band = (lo: string, hi: string, color: string, label: string): Data[] => [
    { x, y: fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x, y: fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: color, line: { width: 0 }, name: label, hoverinfo: "skip" },
  ];
  const data: Data[] = [
    // outer 5–95% band first (drawn behind), then the tighter 25–75% band; the
    // 50% band alone visually understates tail risk on the app's anchor chart
    ...band("p5", "p95", "rgba(88,166,255,0.10)", "5–95%"),
    ...band("p25", "p75", "rgba(88,166,255,0.22)", "25–75%"),
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: ACCENT, width: 2.5 }, hoverinfo: "skip" },
  ];
  // Die-with-zero glidepath: a reference line from the median net worth at
  // retirement down to zero at the horizon. If the median fan floats well above
  // it, that gap is the estate you're on track to leave unspent (real $ only).
  if (props.glidepathToZero && props.display === "real" && props.retirementMarker != null) {
    const i = x.indexOf(props.retirementMarker);
    if (i >= 0) {
      data.push({
        x: [props.retirementMarker, x[x.length - 1]], y: [fan.p50[i], 0],
        type: "scatter", mode: "lines", name: "Die-With-Zero Glidepath",
        line: { color: "#f0883e", width: 1.5, dash: "dot" }, hoverinfo: "skip",
      });
    }
  }
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
      hoverinfo: "skip",
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
    <div style={{ position: "relative" }} onMouseMove={onMove}
      onMouseLeave={() => setTip(null)}>
      <Plot
        data={data}
        onInitialized={(_, gd) => { gdRef.current = gd; }}
        onUpdate={(_, gd) => { gdRef.current = gd; }}
        layout={{
          ...baseLayout, shapes, annotations: annotations as Layout["annotations"],
          height: props.height ?? 420,
          hovermode: false,
          // Preserve the user's zoom/pan across the tooltip's mouse-move
          // re-renders; reset only when the scale itself changes (real↔nominal,
          // age↔year). Without this, drag-to-zoom is wiped on every mouse move.
          uirevision: `${props.display}-${props.axisMode}`,
          // Default the view to the likely range (~p75 + headroom) so the long
          // p95 tail doesn't stretch the axis to tens of millions. The full fan
          // is still drawn — double-click or drag to zoom out to it.
          yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s",
            range: [0, Math.max(...fan.p75.filter((v) => isFinite(v)),
                                ...fan.p50.filter((v) => isFinite(v))) * 1.1],
            autorange: false },
          xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
          title: { text: `Net Worth (${props.display === "real" ? "Today's" : "Nominal"} $)`, font: { size: 14 } },
        }}
        config={config}
        style={{ width: "100%" }}
      />
      {tip && (
        <div className="chart-tip"
          style={{
            top: tip.py - 12,
            left: tip.flip ? undefined : tip.px + 16,
            right: tip.flip ? `calc(100% - ${tip.px - 16}px)` : undefined,
          }}>
          <div className="chart-tip-value">{tip.dollars}</div>
          <div className="chart-tip-sub">
            {tip.where}{tip.pct ? ` · ${tip.pct}` : ""}
          </div>
          <div className="chart-tip-sub">Median {tip.median}</div>
        </div>
      )}
    </div>
  );
});

export const SweepChart = React.memo(function SweepChart(props: {
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
          line: { color: "#3fb950", width: 2.5 },
          hovertemplate: "%{x}: %{y:.1%}<extra></extra>" },
      ]}
      layout={{
        ...baseLayout,
        height: props.height ?? 320,
        // pad below 0 / above 1 so markers at the extremes aren't clipped
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [-0.05, 1.05] },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        shapes: [{
          type: "line", x0: x[0], x1: x[x.length - 1],
          y0: props.sweep.threshold, y1: props.sweep.threshold,
          line: { color: "#d29922", width: 1, dash: "dot" },
        }],
        showlegend: false,
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const FrontierChart = React.memo(function FrontierChart(props: {
  sweep: SweepResult; axisMode: "age" | "year"; birthYear: number;
  retirementMarker?: number | null; height?: number;
  // when given, the estate hover also reads as "≈N yr of spending unspent"
  annualExpenses?: number | null;
}) {
  const e50 = props.sweep.estate_p50;
  if (!e50)
    return <SweepChart sweep={props.sweep} axisMode={props.axisMode}
      birthYear={props.birthYear} height={props.height} />;
  const ages = Object.keys(props.sweep.sweep).map(Number).sort((a, b) => a - b);
  const x = props.axisMode === "age" ? ages : ages.map((a) => a + props.birthYear);
  const success = ages.map((a) => props.sweep.sweep[String(a)]);
  const estate = ages.map((a) => e50[String(a)]);
  const lo = ages.map((a) => props.sweep.estate_p25?.[String(a)] ?? e50[String(a)]);
  const hi = ages.map((a) => props.sweep.estate_p75?.[String(a)] ?? e50[String(a)]);
  const ae = props.annualExpenses && props.annualExpenses > 0 ? props.annualExpenses : null;
  const estateTrace: Data = ae
    ? { x, y: estate, yaxis: "y2", type: "scatter", mode: "lines+markers",
        name: "Median Estate Left", line: { color: "#f0883e", width: 2.5 },
        customdata: estate.map((e) => e / ae),
        hovertemplate: "%{x}: %{y:$,.3s} (≈%{customdata:.0f} yr unspent)<extra></extra>" }
    : { x, y: estate, yaxis: "y2", type: "scatter", mode: "lines+markers",
        name: "Median Estate Left", line: { color: "#f0883e", width: 2.5 },
        hovertemplate: "%{x}: %{y:$,.3s}<extra></extra>" };
  const data: Data[] = [
    { x, y: lo, yaxis: "y2", type: "scatter", mode: "lines", line: { width: 0 },
      hoverinfo: "skip", showlegend: false },
    { x, y: hi, yaxis: "y2", type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: "rgba(240,136,62,0.15)", line: { width: 0 }, name: "Estate 25–75%",
      hoverinfo: "skip" },
    estateTrace,
    { x, y: success, yaxis: "y1", type: "scatter", mode: "lines+markers",
      name: "Success", line: { color: "#3fb950", width: 2.5 },
      hovertemplate: "%{x}: %{y:.1%}<extra></extra>" },
  ];
  const shapes: Partial<Shape>[] = [{
    type: "line", xref: "x", x0: x[0], x1: x[x.length - 1],
    y0: props.sweep.threshold, y1: props.sweep.threshold, yref: "y",
    line: { color: "#3fb950", width: 1, dash: "dot" },
  }];
  const annotations: any[] = [{
    x: x[0], y: props.sweep.threshold, yref: "y", xanchor: "left", yanchor: "bottom",
    showarrow: false, text: `${Math.round(props.sweep.threshold * 100)}% target`,
    font: { color: "#3fb950", size: 10 },
  }];
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 360, hovermode: "x unified",
        margin: { ...baseLayout.margin, r: 64 },  // room for the right-axis title + ticks
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [-0.02, 1.05], automargin: true,
          title: { text: "Success", font: { color: "#3fb950" } } },
        yaxis2: { tickformat: "$.3~s", overlaying: "y", side: "right", rangemode: "tozero",
          gridcolor: "transparent", automargin: true,
          title: { text: "Estate Left", font: { color: "#f0883e" }, standoff: 8 } },
        xaxis: { ...baseLayout.xaxis,
          title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});

export const SweepGainChart = React.memo(function SweepGainChart(props: {
  sweep: SweepResult; axisMode: "age" | "year"; birthYear: number; height?: number;
}) {
  const ages = Object.keys(props.sweep.sweep).map(Number).sort((a, b) => a - b);
  const x = props.axisMode === "age" ? ages : ages.map((a) => a + props.birthYear);
  const success = ages.map((a) => props.sweep.sweep[String(a)]);
  const gain = success.map((s, i) => (i === 0 ? 0 : s - success[i - 1]));
  const data: Data[] = [
    { x, y: gain, type: "bar", name: "Gain From One More Year", yaxis: "y2",
      marker: { color: "rgba(88,166,255,0.5)" },
      hovertemplate: "+%{y:.1%} vs prior age<extra></extra>" },
    { x, y: success, type: "scatter", mode: "lines+markers", name: "Success", yaxis: "y1",
      line: { color: "#3fb950", width: 2.5 }, hovertemplate: "%{x}: %{y:.1%}<extra></extra>" },
  ];
  const shapes: Partial<Shape>[] = [{
    type: "line", xref: "x", x0: x[0], x1: x[x.length - 1],
    y0: props.sweep.threshold, y1: props.sweep.threshold, yref: "y",
    line: { color: "#3fb950", width: 1, dash: "dot" },
  }];
  // Earliest retirement age that clears (and stays above) the success threshold.
  const annotations: any[] = [];
  const crossIdx = success.findIndex((sv) => sv >= props.sweep.threshold);
  if (crossIdx >= 0) {
    shapes.push({ type: "line", x0: x[crossIdx], x1: x[crossIdx], y0: 0, y1: 1, yref: "paper",
      line: { color: "#3fb950", width: 1.5, dash: "dash" } });
    annotations.push({ x: x[crossIdx], y: 1, yref: "paper", yanchor: "bottom", xanchor: "left",
      showarrow: false, text: "Earliest safe", font: { color: "#3fb950", size: 10 } });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified",
        margin: { ...baseLayout.margin, r: 64 },
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [-0.02, 1.05], automargin: true,
          title: { text: "Success" } },
        yaxis2: { tickformat: ".1%", overlaying: "y", side: "right", rangemode: "tozero",
          gridcolor: "transparent", automargin: true, title: { text: "Gain / Year", standoff: 8 } },
        xaxis: { ...baseLayout.xaxis,
          title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
});
