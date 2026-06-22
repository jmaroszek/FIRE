import React, { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Config, Data, Layout, Shape } from "plotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import type { CompareSlot } from "../store";
import type {
  Category, FanSeries, SensitivityResult, SimulateResult, Snapshot, SurfaceResult, SweepResult,
} from "../types";

const RawPlot = createPlotlyComponent(Plotly);

/** Wraps react-plotly so each chart resizes to its CONTAINER, not just the window.
 * Plotly's `responsive: true` only listens for window resizes; but our auto-fit grids
 * (`repeat(auto-fit, minmax(...))`) reflow their column count on window maximize/restore,
 * which changes a tile's width WITHOUT a window resize Plotly reacts to in time — leaving
 * the chart stuck at a stale width until a remount (which is why swapping tabs "fixes" it).
 * A ResizeObserver on the wrapping div catches the real element resize whatever its cause.
 * onInitialized/onUpdate are forwarded so callers (e.g. FanChart's hover) still get the gd. */
function Plot(props: React.ComponentProps<typeof RawPlot>) {
  const gdRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (gdRef.current) void Plotly.Plots.resize(gdRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <RawPlot
        {...props}
        onInitialized={(fig, gd) => { gdRef.current = gd; props.onInitialized?.(fig, gd); }}
        onUpdate={(fig, gd) => { gdRef.current = gd; props.onUpdate?.(fig, gd); }}
      />
    </div>
  );
}

const FG = "#c9d1d9";
const GRID = "#2d333b";
const ACCENT = "#58a6ff";

export const baseLayout: Partial<Layout> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: FG, size: 12 },
  margin: { l: 70, r: 20, t: 30, b: 45 },
  // themed hover spikeline (was an off-theme white/red default under x-unified hover).
  // showspikes + spikemode are required — without them Plotly's unified-hover line
  // falls back to its default white/red styling and ignores spikecolor. Snap to the
  // hovered point and keep it a dim, dotted slate guide so it reads as part of the
  // theme rather than a bright crosshair.
  xaxis: {
    gridcolor: GRID, zeroline: false, showspikes: true, spikemode: "across",
    spikesnap: "hovered data", spikecolor: "#6e7681", spikethickness: 1, spikedash: "dot",
  },
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
/** App-wide semantic palette — the single source of truth for flow/account colors.
 * One hue family per tax bucket, so a given concept keeps the SAME color on every
 * chart, and semantically-related flows share a family but stay distinguishable by
 * shade:
 *   • Traditional / pre-tax → gold   (Traditional, Employer Match)
 *   • Roth                  → green  (contributions → conversions → earnings, dark→light)
 *   • Taxable / Brokerage   → blue
 *   • HSA                   → purple
 *   • Cash                  → gray
 * Income flows (not accounts) sit off the account hues so they never read as a draw:
 *   • Active Income (work)  → teal
 *   • Social Security       → magenta
 */
export const FLOW_COLORS: Record<string, string> = {
  wages: "#39c5cf",                    // active income — teal
  ss: "#f778ba",                       // social security — magenta
  cash: "#8b949e",                     // gray
  taxable: "#58a6ff",                  // blue
  trad: "#d29922",                     // traditional / pre-tax — gold
  match: "#e3b341",                    // employer match (pre-tax) — light gold
  roth: "#3fb950",                     // roth contributions / basis — green
  roth_basis: "#3fb950",
  roth_matured_conversions: "#1a7f37", // matured conversions — dark green
  roth_earnings: "#7ee787",            // roth earnings — light green
  hsa: "#bc8cff",                      // purple
};

const SOURCE_COLORS: Record<string, string> = {
  cash: FLOW_COLORS.cash,
  taxable: FLOW_COLORS.taxable,
  roth_basis: FLOW_COLORS.roth_basis,
  roth_matured_conversions: FLOW_COLORS.roth_matured_conversions,
  trad: FLOW_COLORS.trad,
  hsa: FLOW_COLORS.hsa,
  roth_earnings: FLOW_COLORS.roth_earnings,
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
  const rawFan = props.result.accessibility_fan;
  const ages = props.result.ages;
  const xRaw = props.axisMode === "age" ? [...ages] : [...props.result.years];
  if (!rawFan || !rawFan.p50) return <p className="hint">Simulation pending…</p>;

  // Clip every series at age 60. The bridge ends at 59½; once traditional
  // unlocks at 60 the lines shoot up, and even with the x-axis capped Plotly
  // would draw the 59→60 segment rising into view as a spike at the right edge.
  // Dropping the age-60+ points removes that segment entirely.
  const cut = ages.findIndex((a) => a >= 60);
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
}

/** How each year is funded (stacked, today's $): active work income and Social
 * Security at the base, then the amount drawn from each account source on top.
 * Makes the hand-off explicit — paychecks funding life early, accounts funding it
 * later — so you can see exactly when you stop supplying income and start leaning
 * on the portfolio. (Cash Flow tab; the accessibility chart shows what's merely
 * available, this shows what actually flowed.) */
/** One signed flow chart: contributions as positive bars (money INTO accounts)
 * and withdrawals as negative bars (money OUT), with work income and Social
 * Security as context lines. Merges the old Funding-Sources and Annual-
 * Contributions charts — two halves of the same in/out story — so the picture
 * stays meaningful after retirement instead of going blank once contributions
 * stop. Bars are per-year medians by destination/source; we deliberately do NOT
 * difference them into a "net" or "deficit" line, since medians aren't additive
 * (median(expenses) ≠ Σ median(source)) — the per-path shortfall story lives on
 * Freedom (failure magnitude / survival). */
export function AccountFlowsChart(props: {
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

  const data: Data[] = [];
  cIn.forEach((k, i) => data.push({
    x, y: inv[k], type: "bar", name: CONTRIB_LABELS[k] ?? k,
    legendgroup: "in",
    ...(i === 0 ? { legendgrouptitle: { text: "Contributions" } } : {}),
    marker: { color: (CONTRIB_COLORS[k] ?? "#8b949e") + "cc" },
    hovertemplate: "Contribute %{y:$,.0f}<extra></extra>",
  } as Data));
  cOut.forEach((k, i) => data.push({
    x, y: w[k].map((v) => -v), type: "bar", name: SOURCE_LABELS[k] ?? k,
    legendgroup: "out",
    ...(i === 0 ? { legendgrouptitle: { text: "Withdrawals" } } : {}),
    marker: { color: (SOURCE_COLORS[k] ?? "#8b949e") + "cc" },
    customdata: w[k], hovertemplate: "Withdraw %{customdata:$,.0f}<extra></extra>",
  } as Data));
  if (hasWork) data.push({
    x, y: wages, type: "scatter", mode: "lines", name: "Active Income (Work)",
    legendgroup: "income", legendgrouptitle: { text: "Income" },
    line: { color: FLOW_COLORS.wages, width: 2 },
    hovertemplate: "Work income %{y:$,.0f}<extra></extra>",
  });
  if (hasSS) data.push({
    x, y: ssInc, type: "scatter", mode: "lines", name: "Social Security",
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
}

const POOL_LABELS: Record<string, string> = {
  taxable: "Brokerage", trad: "Traditional", roth: "Roth", hsa: "HSA", cash: "Cash",
};
const POOL_COLORS: Record<string, string> = {
  taxable: FLOW_COLORS.taxable, trad: FLOW_COLORS.trad, roth: FLOW_COLORS.roth,
  hsa: FLOW_COLORS.hsa, cash: FLOW_COLORS.cash,
};
const POOL_ORDER = ["taxable", "trad", "roth", "hsa", "cash"];

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

export function CompareChart(props: {
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
}

/** Bar chart of the age at which failing paths first run short of money. */
export function RuinAgeChart(props: {
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
  yRange?: [number, number];
}) {
  const c = props.color ?? ACCENT;
  const band = (lo: string, hi: string, alpha: string, label: string): Data[] => [
    { x: props.x, y: props.fan[lo], type: "scatter", mode: "lines",
      line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { x: props.x, y: props.fan[hi], type: "scatter", mode: "lines", fill: "tonexty",
      fillcolor: c + alpha, line: { width: 0 }, name: label, hoverinfo: "skip" },
  ];
  const data: Data[] = [
    ...band("p5", "p95", "12", "5–95% Of Paths"),
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
          title: { text: props.axisMode === "age" ? "Age" : "Year" } },
        title: { text: props.title, font: { size: 14 } },
      }}
      config={config}
      style={{ width: "100%" }}
    />
  );
}

// ---- named wrappers consuming summarize() series -------------------------

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
      title="" />
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
  const x = props.axisMode === "age" ? [...props.result.ages] : [...props.result.years];
  const refs = [{ value: 1, label: "Plan (100%)", color: "#8b949e" }];
  if (props.floor > 0) refs.push({ value: props.floor, label: "Floor", color: "#8b949e" });
  if (props.cap > 1) refs.push({ value: props.cap, label: "Cap", color: "#3fb950" });
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
}

/** Compact in-tile preview for the Spending Strategy picker: the dollar lifestyle
 * the chosen strategy actually funds over time — median realized spending (today's $)
 * with a downside band (the 1-in-4 bad case, p25, up to the median). The p25 is the
 * planning-relevant downside — the bad-but-not-tail year you should expect to weather
 * — rather than the rarer 10th-percentile shock. Before retirement everyone spends to
 * plan, so the band only opens up once the strategy starts flexing, which is exactly
 * the contrast between strategies you want to see. The full percentile deep-dive
 * (framed as % of plan) lives in the Freedom tab's Realized Spending chart; this is
 * the at-a-glance companion to the dropdown. */
export function SpendingPreviewChart(props: {
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
}

// ---- Phase 2C composites (merge several scattered charts into one) --------

/** Net healthcare cost over life: ACA premium after subsidy (pre-65) plus the
 * IRMAA surcharge (65+), with the subsidy shown alongside. Median path, today's
 * $. Empty (both ACA and IRMAA off) -> the caller shows a hint instead. */
export function HealthcareCostChart(props: {
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
}

/** The ACA-vs-conversion tension made visible: Roth conversions raise MAGI,
 * which shrinks the ACA subsidy. Median conversion $/yr from the ladder against
 * the subsidy received — watch the subsidy dip in the high-conversion years. */
export function SubsidyConversionChart(props: {
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
}

/** Account balances by tax pool over the plan (stacked area, today's $). Purely
 * the growth/composition story — the contribution and withdrawal FLOWS now live
 * on the Cash Flow tab (ContributionsChart / FundingSourceChart), so a stock and
 * a flow are no longer conflated on one chart. */
export function WealthFlowsChart(props: {
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
}

const CONTRIB_LABELS: Record<string, string> = {
  match: "Employer Match", trad: "Traditional", roth: "Roth", hsa: "HSA",
  taxable: "Brokerage", cash: "Cash",
};
const CONTRIB_COLORS: Record<string, string> = {
  match: FLOW_COLORS.match, trad: FLOW_COLORS.trad, roth: FLOW_COLORS.roth,
  hsa: FLOW_COLORS.hsa, taxable: FLOW_COLORS.taxable, cash: FLOW_COLORS.cash,
};

/** Taxes over time: annual tax dollars (bars, left) with the marginal and
 * effective rates (lines, right) — merges Annual Taxes and Marginal Rate, and
 * adds the effective line that answers "why is marginal so high?". */
export function AnnualTaxRateChart(props: {
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
}

/** When can I retire: the success-vs-retirement-age curve (left) with the gain
 * from working one more year as bars (right) and the earliest-safe marker —
 * replaces the separate Years-to-Retirement and One-More-Year tiles. */
export function SweepGainChart(props: {
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
}

