import React, { useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Config, Data, Layout, Shape } from "plotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import type { CompareSlot } from "../store";
import type {
  Category, FanSeries, SensitivityResult, SimulateResult, Snapshot, SurfaceResult, SweepResult,
} from "../types";

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
  hoverlabel: {
    bgcolor: "#1c2128", bordercolor: "#2d333b",
    font: { color: FG, size: 12 },
  },
};

const config: Partial<Config> = { displayModeBar: false, responsive: true };

function xValues(result: SimulateResult, axisMode: "age" | "year", extraPoint = true): number[] {
  const base = axisMode === "age" ? result.ages : result.years;
  // fan series have T+1 points ([0] = today); ages/years have T
  return extraPoint ? [base[0] - 1, ...base] : [...base];
}

const fmtTipMoney = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Estimate which percentile of outcomes a dollar value sits at, by linear
 * interpolation between the fan's percentile curves at one time step. */
export function percentileAt(fan: Record<string, number[]>, i: number, y: number): string | null {
  const levels: [number, number][] = [5, 25, 50, 75, 95].map(
    (p) => [p, fan[`p${p}`][i]] as [number, number]);
  if (y < levels[0][1]) return "below 5th percentile";
  if (y > levels[levels.length - 1][1]) return "above 95th percentile";
  for (let k = 0; k < levels.length - 1; k++) {
    const [pLo, vLo] = levels[k];
    const [pHi, vHi] = levels[k + 1];
    if (y >= vLo && y <= vHi) {
      const frac = vHi > vLo ? (y - vLo) / (vHi - vLo) : 0;
      return `≈ ${Math.round(pLo + frac * (pHi - pLo))}th percentile`;
    }
  }
  return null;
}

export function FanChart(props: {
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
          yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
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
        title: { text: "Success Probability vs Retirement Age", font: { size: 14 } },
        showlegend: false,
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Over-Saving Frontier: success probability (left axis) and the median real
 * ending estate with a p25–75 band (right axis), both vs retirement age. The
 * die-with-zero read: find the earliest age where success clears your target but
 * the estate hasn't ballooned — anything later is years of work funding an estate
 * you won't spend. Falls back to the plain success curve if the backend predates
 * the estate data. */
export function FrontierChart(props: {
  sweep: SweepResult; axisMode: "age" | "year"; birthYear: number;
  retirementMarker?: number | null; height?: number;
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
  const data: Data[] = [
    { x, y: lo, yaxis: "y2", type: "scatter", mode: "lines", line: { width: 0 },
      hoverinfo: "skip", showlegend: false },
    { x, y: hi, yaxis: "y2", type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: "rgba(240,136,62,0.15)", line: { width: 0 }, name: "Estate 25–75%",
      hoverinfo: "skip" },
    { x, y: estate, yaxis: "y2", type: "scatter", mode: "lines+markers",
      name: "Median Estate Left", line: { color: "#f0883e", width: 2.5 },
      hovertemplate: "%{x}: %{y:$,.3s}<extra></extra>" },
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
  if (props.retirementMarker != null) {
    shapes.push({ type: "line", x0: props.retirementMarker, x1: props.retirementMarker,
      y0: 0, y1: 1, yref: "paper", line: { color: "#8b949e", width: 1.5, dash: "dash" } });
    annotations.push({ x: props.retirementMarker, y: 1, yref: "paper", yanchor: "bottom",
      showarrow: false, text: "Planned", font: { color: "#8b949e", size: 10 } });
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 360, hovermode: "x unified",
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: { ...baseLayout.yaxis, tickformat: ".0%", range: [-0.02, 1.05],
          title: { text: "Success", font: { color: "#3fb950" } } },
        yaxis2: { tickformat: "$.3~s", overlaying: "y", side: "right", rangemode: "tozero",
          gridcolor: "transparent", title: { text: "Estate Left", font: { color: "#f0883e" } } },
        xaxis: { ...baseLayout.xaxis,
          title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        title: { text: "Over-Saving Frontier: Success vs Estate You Leave", font: { size: 14 } },
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
    name: SOURCE_LABELS[src] ?? src,
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
        title: { text: "Accessible (Penalty-Free) Assets By Source — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Percentile fan of TOTAL penalty-free accessible dollars over time (real). The
 * median stack shows composition; this shows dispersion. The p5 line diving toward
 * zero before the 59½ marker is the bridge-failure signal the median can't show. */
export function AccessibilityFanChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementMarker?: number | null; retirementAge?: number | null;
  birthYear?: number; height?: number;
}) {
  const fan = props.result.accessibility_fan;
  const ages = props.result.ages;
  const x = props.axisMode === "age" ? [...ages] : [...props.result.years];
  if (!fan || !fan.p50) return <p className="hint">Simulation pending…</p>;

  // Focus the view on the bridge era. After 59½ the traditional pool unlocks and
  // decades of compounding blow the y-scale into the tens of millions, burying the
  // bridge detail this chart exists to show — so cap both axes a few years past 60.
  let xRange: [number, number] | undefined;
  let yRange: [number, number] | undefined;
  if (props.retirementAge != null) {
    const ra = props.retirementAge;
    const off = props.axisMode === "age" ? 0 : (props.birthYear ?? 0);
    xRange = [ra - 3 + off, 65 + off];
    // scale to the pre-60 (penalty-locked) era only; the 59½ unlock sends the
    // lines off the top, which reads correctly as "everything opens up at 60".
    let ymax = 0;
    for (let i = 0; i < ages.length; i++) {
      if (ages[i] >= ra - 1 && ages[i] < 60) ymax = Math.max(ymax, fan.p95[i] ?? 0);
    }
    if (ymax > 0) yRange = [0, ymax * 1.12];
  }

  const band = (lo: string, hi: string, color: string, label: string): Data[] => [
    { x, y: fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x, y: fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: color, line: { width: 0 }, name: label, hoverinfo: "skip" },
  ];
  const data: Data[] = [
    ...band("p5", "p95", "rgba(63,185,80,0.10)", "5–95%"),
    ...band("p25", "p75", "rgba(63,185,80,0.22)", "25–75%"),
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: "#3fb950", width: 2.5 }, hovertemplate: "%{y:$,.0f}" },
    { x, y: fan.p5, type: "scatter", mode: "lines", name: "Worst 5%",
      line: { color: "#f85149", width: 1.5, dash: "dot" }, hovertemplate: "%{y:$,.0f}" },
  ];

  const shapes: Partial<Shape>[] = [];
  const annotations: Partial<Layout["annotations"][number]>[] = [];
  const pf = props.axisMode === "age" ? 59.5 : (props.birthYear ?? 0) + 59.5;
  shapes.push({ type: "line", x0: pf, x1: pf, y0: 0, y1: 1, yref: "paper",
    line: { color: "#f0883e", width: 1.5, dash: "dash" } });
  annotations.push({ x: pf, y: 1, yref: "paper", text: "59½", showarrow: false,
    yanchor: "bottom", font: { color: "#f0883e", size: 11 } });
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
}

/** Median amount actually withdrawn from each source per year (stacked, today's
 * $) — the funding sequence the withdrawal policy produces, vs the accessibility
 * chart which shows what was merely available. */
export function WithdrawalSourceChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const order = ["cash", "taxable", "roth_basis", "roth_matured_conversions",
                 "trad", "hsa", "roth_earnings"];
  const w = props.result.withdrawals_real ?? {};
  const present = order.filter((src) => w[src]?.some((v) => v > 1));
  if (!present.length)
    return (
      <p className="hint">
        No withdrawals on the median path yet — still accumulating, or spending is
        covered by wages, Social Security, and RMDs.
      </p>
    );
  const data: Data[] = present.map((src) => ({
    x: [...x], y: w[src], type: "scatter" as const, mode: "lines" as const,
    stackgroup: "one", name: SOURCE_LABELS[src] ?? src,
    line: { width: 0.5, color: SOURCE_COLORS[src] },
    fillcolor: (SOURCE_COLORS[src] ?? "#8b949e") + "66",
    hovertemplate: "%{y:$,.0f}",
  }));
  const totals = [...x].map((_, i) =>
    present.reduce((sum, src) => sum + (w[src][i] ?? 0), 0));
  data.push({
    x: [...x], y: totals, type: "scatter", mode: "lines", name: "Total",
    line: { width: 0 }, showlegend: false,
    hovertemplate: "Total drawn: %{y:$,.0f}<extra></extra>",
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 340, hovermode: "x unified",
        legend: { ...baseLayout.legend, traceorder: "reversed" },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Spending Funded By Source — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

const INVEST_LABELS: Record<string, string> = {
  trad: "Traditional",
  match: "Employer Match",
  hsa: "HSA",
  roth: "Roth",
  taxable: "Brokerage",
  cash: "Cash Savings",
};
const INVEST_COLORS: Record<string, string> = {
  trad: "#d29922",
  match: "#e3b341",
  hsa: "#bc8cff",
  roth: "#3fb950",
  taxable: "#58a6ff",
  cash: "#8b949e",
};
const INVEST_ORDER = ["trad", "match", "hsa", "roth", "taxable", "cash"];

export function InvestingChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const inv = props.result.investing_real ?? {};
  const keys = INVEST_ORDER.filter((k) => inv[k]?.some((v) => v > 1));
  const data: Data[] = keys.map((k) => ({
    x: [...x],
    y: inv[k],
    type: "bar" as const,
    name: INVEST_LABELS[k],
    marker: { color: INVEST_COLORS[k] },
    hovertemplate: `${INVEST_LABELS[k]}: %{y:$,.0f}<extra></extra>`,
  }));
  // Transparent overlay trace so the unified hover gets a "Total" row summing
  // every destination at that year; sits at the top of the stack, draws nothing.
  const totals = [...x].map((_, i) => keys.reduce((sum, k) => sum + (inv[k]?.[i] ?? 0), 0));
  data.push({
    x: [...x], y: totals, type: "scatter", mode: "lines", name: "Total",
    line: { width: 0 }, showlegend: false,
    hovertemplate: "Total: %{y:$,.0f}<extra></extra>",
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 380,
        barmode: "stack",
        bargap: 0.15,
        hovermode: "x unified",
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Annual Saving & Investing By Destination — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

const POOL_LABELS: Record<string, string> = {
  taxable: "Brokerage", trad: "Traditional", roth: "Roth", hsa: "HSA", cash: "Cash",
};
const POOL_COLORS: Record<string, string> = {
  taxable: "#58a6ff", trad: "#d29922", roth: "#3fb950", hsa: "#bc8cff", cash: "#8b949e",
};
const POOL_ORDER = ["taxable", "trad", "roth", "hsa", "cash"];

/** Median balance of each tax pool over time (today's $), stacked — shows how
 * the mix shifts across accumulation, conversions, and drawdown. */
export function AccountBalanceChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const x = xValues(props.result, props.axisMode); // pools carry T+1 points
  const pools = props.result.pool_medians_real ?? {};
  const keys = POOL_ORDER.filter((k) => pools[k]?.some((v) => v > 1));
  const data: Data[] = keys.map((k) => ({
    x,
    y: pools[k],
    type: "scatter" as const,
    mode: "lines" as const,
    stackgroup: "one",
    name: POOL_LABELS[k],
    line: { width: 0.5, color: POOL_COLORS[k] },
    fillcolor: POOL_COLORS[k] + "66",
    hovertemplate: "%{y:$,.0f}",
  }));
  const totals = x.map((_, i) => keys.reduce((sum, k) => sum + (pools[k]?.[i] ?? 0), 0));
  data.push({
    x, y: totals, type: "scatter", mode: "lines", name: "Total",
    line: { width: 0 }, showlegend: false,
    hovertemplate: "Total: %{y:$,.0f}<extra></extra>",
  });
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout,
        height: props.height ?? 360,
        hovermode: "x unified",
        legend: { ...baseLayout.legend, traceorder: "reversed" },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Account Balances Over Time — Median Path, Today's $", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

const SPEND_PALETTE = [
  "#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72",
  "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#ffa657", "#8b949e", "#6e7681",
];

/** Recorded annual spending by category across snapshots, in today's dollars
 * (past nominals grown by the assumed mean inflation), with the current plan
 * total as a reference line. Lifestyle creep = bars climbing past the line. */
export function SpendingActualsChart(props: {
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
}

export function TaxesChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; height?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <Plot
      data={[
        { x: [...x], y: props.result.taxes_median_real, type: "scatter",
          mode: "lines", name: "Taxes", fill: "tozeroy",
          line: { color: "#f0883e", width: 2 }, fillcolor: "rgba(240,136,62,0.18)",
          hovertemplate: "Taxes: %{y:$,.0f}<extra></extra>" },
      ]}
      layout={{
        ...baseLayout,
        height: props.height ?? 300,
        hovermode: "x unified",
        showlegend: false,
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero" },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: "Federal + State + FICA + Penalties — Median Path, Today's $", font: { size: 14 } },
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

/** Overlay each pinned scenario's MEDIAN total penalty-free assets through the
 * bridge era — the A/B view of "whose early-retirement runway holds up". Focused
 * on the pre-60 window and capped to bridge magnitude (the 59½ unlock runs off
 * the top), so the comparison isn't crushed by post-unlock compounding. */
export function CompareBridgeChart(props: {
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
}

// ---- outcome-distribution & robustness charts (Risk tab) -----------------

type HistUnit = "money" | "percent" | "years" | "number";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const histTickFormat = (u: HistUnit): string | undefined =>
  u === "money" ? "$.3~s" : u === "percent" ? ".0%" : undefined;

/** Histogram of a per-path quantity (ending balance, lifetime spend, drawdown).
 * Draws dashed reference lines for the supplied markers (median by default). */
export function HistogramChart(props: {
  values: number[];
  title: string;
  xTitle: string;
  unit?: HistUnit;
  color?: string;
  markers?: { value: number; label: string; color?: string }[];
  uirevision?: string;
  height?: number;
}) {
  const unit = props.unit ?? "money";
  const color = props.color ?? "rgba(88,166,255,0.55)";
  const markers = props.markers ?? [{ value: median(props.values), label: "Median", color: ACCENT }];
  const hoverX = unit === "money" ? "%{x:$,.0f}" : unit === "percent" ? "%{x:.0%}" : "%{x:,.0f}";
  const shapes: Partial<Shape>[] = markers.map((mk) => ({
    type: "line", x0: mk.value, x1: mk.value, y0: 0, y1: 1, yref: "paper",
    line: { color: mk.color ?? ACCENT, width: 1.5, dash: "dash" },
  }));
  const annotations = markers.map((mk) => ({
    x: mk.value, y: 1, yref: "paper" as const, yanchor: "bottom" as const,
    text: mk.label, showarrow: false, font: { color: mk.color ?? ACCENT, size: 11 },
  }));
  return (
    <Plot
      data={[{
        x: props.values, type: "histogram", nbinsx: 40,
        marker: { color, line: { color: "#1c2128", width: 0.5 } },
        hovertemplate: `${hoverX}<br>%{y} paths<extra></extra>`,
      } as Data]}
      layout={{
        ...baseLayout, height: props.height ?? 300, showlegend: false, bargap: 0.02,
        uirevision: props.uirevision ?? props.title,
        shapes, annotations: annotations as Layout["annotations"],
        xaxis: { ...baseLayout.xaxis, tickformat: histTickFormat(unit), title: { text: props.xTitle } },
        yaxis: { ...baseLayout.yaxis, title: { text: "Paths" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Bar chart of the age at which failing paths first run short of money. */
export function RuinAgeChart(props: {
  data: SimulateResult["age_at_ruin"]; height?: number;
}) {
  const { ages, counts, total_paths, success_paths } = props.data;
  if (!ages.length) {
    return (
      <p className="hint">
        No path ran short — every Monte Carlo path funded spending through the horizon.
      </p>
    );
  }
  return (
    <Plot
      data={[{
        x: ages, y: counts, type: "bar",
        marker: { color: "#ff7b72" },
        hovertemplate: "Age %{x}<br>%{y} paths fail here<extra></extra>",
      }]}
      layout={{
        ...baseLayout, height: props.height ?? 300, showlegend: false,
        xaxis: { ...baseLayout.xaxis, title: { text: "Age At First Shortfall" } },
        yaxis: { ...baseLayout.yaxis, title: { text: "Paths" } },
        title: {
          text: `When Plans Fail — ${success_paths} of ${total_paths} never run short`,
          font: { size: 14 },
        },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Scatter of each path's mean real return over its first window of years vs.
 * its ending wealth, colored by survival — the sequence-of-returns story. */
export function SequenceScatter(props: {
  data: SimulateResult["sequence_scatter"]; height?: number;
}) {
  const { first_window_return, ending_real, survived, window } = props.data;
  if (!first_window_return.length) return <p className="hint">Sequence data unavailable.</p>;
  const split = (keep: boolean) => {
    const xs: number[] = [], ys: number[] = [];
    survived.forEach((s, i) => {
      if (s === keep) { xs.push(first_window_return[i]); ys.push(ending_real[i]); }
    });
    return { xs, ys };
  };
  const win = split(true), lose = split(false);
  const tip = (label: string) =>
    `First-${window}yr real return %{x:.1%}<br>Ending %{y:$,.0f}<extra>${label}</extra>`;
  return (
    <Plot
      data={[
        { x: lose.xs, y: lose.ys, type: "scatter", mode: "markers", name: "Ran short",
          marker: { color: "rgba(255,123,114,0.55)", size: 5 }, hovertemplate: tip("Ran short") },
        { x: win.xs, y: win.ys, type: "scatter", mode: "markers", name: "Survived",
          marker: { color: "rgba(63,185,80,0.55)", size: 5 }, hovertemplate: tip("Survived") },
      ]}
      layout={{
        ...baseLayout, height: props.height ?? 340,
        xaxis: { ...baseLayout.xaxis, tickformat: ".0%", title: { text: `Mean Real Return, First ${window} Years` } },
        yaxis: { ...baseLayout.yaxis, tickformat: "$.3~s", rangemode: "tozero", title: { text: "Ending Net Worth (Today's $)" } },
        title: { text: "Sequence-Of-Returns Risk", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Heatmap of success rate over (retirement age × spending scale). */
export function SurfaceHeatmap(props: {
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
    // the threshold iso-line IS the "retire-here-or-later" frontier — a drawn
    // contour reads more precisely than the colour transition alone
    {
      x, y, z: matrix, type: "contour",
      showscale: false, hoverinfo: "skip",
      contours: { start: threshold, end: threshold, size: 0.0001, coloring: "lines" },
      line: { color: "#f0f6fc", width: 2 },
    } as Data,
  ];
  // crosshair at the plan as configured today (planned age, 100% of spend)
  const markX = props.currentAge != null
    ? (props.axisMode === "age" ? props.currentAge : props.currentAge + props.birthYear)
    : null;
  if (markX != null) {
    data.push({
      x: [markX], y: [100], type: "scatter", mode: "markers", name: "You Are Here",
      marker: { symbol: "circle-open", size: 16, color: "#f0f6fc", line: { width: 2.5 } },
      hovertemplate: "Your plan: retire %{x}, 100% spend<extra></extra>",
    } as Data);
  }
  return (
    <Plot
      data={data}
      layout={{
        ...baseLayout, height: props.height ?? 360, showlegend: false,
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Retirement Age" : "Retirement Year" } },
        yaxis: { ...baseLayout.yaxis, title: { text: "Spending (% Of Plan)" } },
        title: { text: `Success Surface (white line = ${(threshold * 100).toFixed(0)}% threshold)`, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Horizontal tornado of one-at-a-time sensitivity, biggest swing on top. */
export function TornadoChart(props: { data: SensitivityResult; height?: number }) {
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
        shapes: [{
          type: "line", x0: base_success, x1: base_success, y0: -0.5, y1: rows.length - 0.5,
          line: { color: "#8b949e", width: 1.5, dash: "dash" },
        }],
        annotations: [{
          x: base_success, y: rows.length - 0.5, yanchor: "bottom", text: "base",
          showarrow: false, font: { color: "#8b949e", size: 11 },
        }] as Layout["annotations"],
        xaxis: { ...baseLayout.xaxis, tickformat: ".0%", range: [0, 1], title: { text: "Success Rate (input ±10%, retire age ±2 yr)" } },
        yaxis: { ...baseLayout.yaxis, automargin: true },
        title: { text: "What Moves The Needle", font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

// ---- shared time-axis primitives (Phase C) -------------------------------

type YFmt = "money" | "percent" | "multiplier";
const yTick = (f: YFmt) => (f === "money" ? "$.3~s" : f === "percent" ? ".0%" : ".2f");
const yHover = (f: YFmt) => (f === "money" ? "%{y:$,.0f}" : f === "percent" ? "%{y:.1%}" : "%{y:.2f}×");

interface LifeMark { age: number; label: string; color?: string }

/** Dashed vertical guides at life-stage ages (retire / 59½ / 65 / 75 / SS), so
 * every time-axis chart marks the same milestones consistently instead of each
 * reinventing them. Converts age→x for the active axis mode. */
function lifeStageMarkers(axisMode: "age" | "year", birthYear: number | undefined,
                          marks: LifeMark[]): { shapes: Partial<Shape>[]; annotations: any[] } {
  const shapes: Partial<Shape>[] = [];
  const annotations: any[] = [];
  for (const m of marks) {
    const xv = axisMode === "age" ? m.age : m.age + (birthYear ?? 0);
    shapes.push({
      type: "line", x0: xv, x1: xv, y0: 0, y1: 1, yref: "paper",
      line: { color: m.color ?? "#8b949e", width: 1.5, dash: "dash" },
    });
    annotations.push({
      x: xv, y: 1, yref: "paper", yanchor: "bottom", showarrow: false,
      text: m.label, font: { color: m.color ?? "#8b949e", size: 10 },
    });
  }
  return { shapes, annotations };
}

/** Generic single/multi-series line or area chart over an age/year axis, with
 * optional life-stage markers and horizontal reference lines. */
export function SeriesChart(props: {
  x: number[]; axisMode: "age" | "year"; yFormat: YFmt; title: string;
  series: { name: string; values: number[]; color: string; fill?: boolean }[];
  markers?: { shapes: Partial<Shape>[]; annotations: any[] };
  refLines?: { value: number; label: string; color?: string }[];
  height?: number; legend?: boolean;
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
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

/** Percentile fan (5–95 / 25–75 / median) for a series that can go negative,
 * so it does not force a zero baseline like the net-worth FanChart. */
export function PercentileFanChart(props: {
  x: number[]; fan: FanSeries; axisMode: "age" | "year"; yFormat: YFmt; title: string;
  color?: string; markers?: { shapes: Partial<Shape>[]; annotations: any[] };
  refLines?: { value: number; label: string; color?: string }[]; height?: number;
}) {
  const c = props.color ?? ACCENT;
  const band = (lo: string, hi: string, alpha: string): Data[] => [
    { x: props.x, y: props.fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x: props.x, y: props.fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: c + alpha, line: { width: 0 }, hoverinfo: "skip", showlegend: false },
  ];
  const data: Data[] = [
    ...band("p5", "p95", "12"),
    ...band("p25", "p75", "24"),
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
        ...baseLayout, height: props.height ?? 320, showlegend: false,
        shapes, annotations: annotations as Layout["annotations"],
        yaxis: {
          ...baseLayout.yaxis, tickformat: yTick(props.yFormat),
          ticksuffix: props.yFormat === "multiplier" ? "×" : undefined,
        },
        xaxis: { ...baseLayout.xaxis, title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

// ---- named wrappers consuming summarize() series -------------------------

export function MarginalRateChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge: number; claimingAge?: number; birthYear?: number; height?: number;
}) {
  if (!props.result.marginal_rate_median?.length)
    return <p className="hint">No conversion-rate data.</p>;
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const marks: LifeMark[] = [
    { age: props.retirementAge, label: "Retire", color: "#d29922" },
    { age: 60, label: "59½", color: "#f0883e" },
    { age: 75, label: "RMD 75", color: "#8b949e" },
  ];
  if (props.claimingAge) marks.push({ age: props.claimingAge, label: "SS", color: "#56d364" });
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="percent" height={props.height}
      series={[{ name: "Next $ Taxed At", values: props.result.marginal_rate_median, color: "#f0883e", fill: true }]}
      refLines={[{ value: 0.12, label: "12%" }, { value: 0.22, label: "22%" }, { value: 0.24, label: "24%" }]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, marks)}
      title="Marginal Tax Rate On The Next Conversion Dollar — Median Path" />
  );
}

export function SpendingTrajectoryChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number; birthYear?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money"
      series={[{ name: "Planned Spending", values: props.result.expenses_median_real, color: ACCENT, fill: true }]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.retirementAge, label: "Retire", color: "#d29922" }])}
      title="Planned Spending — Median Path, Today's $" />
  );
}

/** Bill-Perkins-style enjoyment decay: a dollar buys full living through the
 * go-go years, then less as health and energy fade. Full to `goGoEnd` (75),
 * tapering linearly to `floor` (0.3) by `taperEnd` (90), flat thereafter. */
export function enjoymentFactor(age: number, goGoEnd = 75, floor = 0.3, taperEnd = 90): number {
  if (age <= goGoEnd) return 1;
  if (age >= taperEnd) return floor;
  return 1 - ((age - goGoEnd) / (taperEnd - goGoEnd)) * (1 - floor);
}

/** Die-with-zero spending-timing lens: planned spending vs the same dollars
 * weighted by ability to enjoy them, over go-go / slow-go / no-go age bands. A
 * weighted line that droops far below planned spending in late years means money
 * is being saved for years it can't fully be enjoyed. */
export function FulfillmentChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number;
  birthYear?: number; goGoEnd?: number; floor?: number; height?: number;
}) {
  const goGoEnd = props.goGoEnd ?? 75;
  const slowGoEnd = 85;
  const floor = props.floor ?? 0.3;
  const ages = props.result.ages;
  const x = props.axisMode === "age" ? [...ages] : [...props.result.years];
  const spend = props.result.expenses_median_real;
  const weighted = spend.map((v, i) => v * enjoymentFactor(ages[i], goGoEnd, floor));
  const off = props.axisMode === "age" ? 0 : (props.birthYear ?? 0);
  const xEnd = x[x.length - 1];
  const band = (a0: number, a1: number, color: string, label: string) => {
    const x0 = Math.max(a0 + off, x[0]);
    const x1 = Math.min(a1 + off, xEnd);
    return {
      shape: { type: "rect" as const, xref: "x" as const, yref: "paper" as const,
        x0, x1, y0: 0, y1: 1, fillcolor: color, line: { width: 0 }, layer: "below" as const },
      anno: { x: (x0 + x1) / 2, y: 0.98, yref: "paper" as const, yanchor: "top" as const,
        showarrow: false, text: label, font: { size: 10, color: "#8b949e" } },
    };
  };
  const bands = [
    band(0, goGoEnd, "rgba(63,185,80,0.08)", "Go-Go"),
    band(goGoEnd, slowGoEnd, "rgba(210,153,34,0.08)", "Slow-Go"),
    band(slowGoEnd, 200, "rgba(248,81,73,0.08)", "No-Go"),
  ];
  const retire = lifeStageMarkers(props.axisMode, props.birthYear,
    [{ age: props.retirementAge, label: "Retire", color: "#d29922" }]);
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend height={props.height}
      series={[
        { name: "Planned Spending", values: spend, color: ACCENT, fill: true },
        { name: "Enjoyment-Weighted", values: weighted, color: "#f0883e" },
      ]}
      markers={{
        shapes: [...bands.map((b) => b.shape), ...retire.shapes],
        annotations: [...bands.map((b) => b.anno), ...retire.annotations],
      }}
      title="Spending vs Ability To Enjoy It — Median Path, Today's $" />
  );
}

/** Traditional over-funding: median forced RMD vs median spending after 70, with
 * the gap where the RMD exceeds spending shaded — ordinary income you're forced to
 * realize (and tax) without needing it, the signature of having deferred too much. */
export function TradOverfundingChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; birthYear?: number; height?: number;
}) {
  const rmd = props.result.rmds_median_real ?? [];
  if (!rmd.length || rmd.every((v) => v < 1))
    return <p className="hint">No projected RMDs on the median path — your traditional
      balance is drained before 75 (the ladder defused it) or the horizon ends before then.</p>;
  const ages = props.result.ages;
  const spend = props.result.expenses_median_real;
  let start = ages.findIndex((a) => a >= 70);
  if (start < 0) start = 0;
  const x = props.axisMode === "age"
    ? [...ages.slice(start)] : [...props.result.years.slice(start)];
  const rmdS = rmd.slice(start);
  const spendS = spend.slice(start);
  const surplus = rmdS.map((v, i) => Math.max(v - (spendS[i] ?? 0), 0));
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend height={props.height}
      series={[
        { name: "Spending", values: spendS, color: ACCENT },
        { name: "RMD (Forced Withdrawal)", values: rmdS, color: "#d29922" },
        { name: "Forced Surplus (RMD − Spend)", values: surplus, color: "#f85149", fill: true },
      ]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear,
        [{ age: 75, label: "RMD 75", color: "#8b949e" }])}
      title="Forced Withdrawals vs Spending — Median Path, Today's $" />
  );
}

export function HealthcareTrajectoryChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge: number; coverageEndAge: number; birthYear?: number;
}) {
  const hc = props.result.healthcare;
  if (!hc?.net_cost_real && !hc?.subsidy_real)
    return <p className="hint">Enable ACA or IRMAA above to chart net healthcare cost over time.</p>;
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const series: { name: string; values: number[]; color: string; fill?: boolean }[] = [];
  if (hc.net_cost_real) series.push({ name: "Net Cost (After Subsidy)", values: hc.net_cost_real, color: "#f0883e", fill: true });
  if (hc.subsidy_real) series.push({ name: "ACA Subsidy", values: hc.subsidy_real, color: "#3fb950" });
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money" legend
      series={series}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [
        { age: props.retirementAge, label: "Retire", color: "#d29922" },
        { age: props.coverageEndAge, label: `Medicare ${props.coverageEndAge}`, color: "#bc8cff" },
      ])}
      title="Healthcare Cost & ACA Subsidy — Median Path, Today's $" />
  );
}

export function SsIncomeChart(props: {
  result: SimulateResult; axisMode: "age" | "year"; claimingAge: number; birthYear?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="money"
      series={[{ name: "Social Security", values: props.result.ss_income_median_real, color: "#56d364", fill: true }]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.claimingAge, label: `Claim ${props.claimingAge}`, color: "#56d364" }])}
      title="Social Security Income — Median Path, Today's $" />
  );
}

export function SurvivalChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
  retirementAge: number; threshold?: number; birthYear?: number;
}) {
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="percent"
      series={[{ name: "Still Funded", values: props.result.survival_curve, color: "#3fb950", fill: true }]}
      refLines={props.threshold != null ? [{ value: props.threshold, label: "Success Threshold", color: "#d29922" }] : []}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.retirementAge, label: "Retire", color: "#d29922" }])}
      title="Survival Curve — Share Of Paths Still Funded By Each Age" />
  );
}

export function SpendingDepthChart(props: {
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
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  const refs = [{ value: 1, label: "Plan (100%)", color: "#8b949e" }];
  if (props.floor > 0) refs.push({ value: props.floor, label: "Floor", color: "#ff7b72" });
  if (props.cap > 1) refs.push({ value: props.cap, label: "Cap", color: "#3fb950" });
  return (
    <SeriesChart x={x} axisMode={props.axisMode} yFormat="percent"
      series={[{ name: "Discretionary vs Plan", values: props.result.spending_mult_median, color: ACCENT, fill: true }]}
      refLines={refs}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.retirementAge, label: "Retire", color: "#d29922" }])}
      title="Realized Spending Level — Median Path (% Of Planned Discretionary)" />
  );
}

export function RealizedReturnFan(props: {
  result: SimulateResult; axisMode: "age" | "year"; retirementAge: number; birthYear?: number;
}) {
  if (!props.result.port_return_fan?.p50?.length)
    return <p className="hint">Return data unavailable.</p>;
  const x = props.axisMode === "age" ? props.result.ages : props.result.years;
  return (
    <PercentileFanChart x={x} fan={props.result.port_return_fan} axisMode={props.axisMode}
      yFormat="percent" color="#58a6ff"
      refLines={[{ value: 0, label: "0%", color: "#8b949e" }]}
      markers={lifeStageMarkers(props.axisMode, props.birthYear, [{ age: props.retirementAge, label: "Retire", color: "#d29922" }])}
      title="Realized Real Portfolio Return — Percentile Fan" />
  );
}

export function InflationFanChart(props: {
  result: SimulateResult; axisMode: "age" | "year";
}) {
  if (!props.result.inflation_fan?.p50?.length) return null;
  const x = xValues(props.result, props.axisMode); // price level carries T+1 points
  return (
    <PercentileFanChart x={x} fan={props.result.inflation_fan} axisMode={props.axisMode}
      yFormat="multiplier" color="#d29922"
      refLines={[{ value: 1, label: "Today", color: "#8b949e" }]}
      title="Cumulative Inflation — Price Level vs Today" />
  );
}
