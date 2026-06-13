import React, { useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Config, Data, Layout, Shape } from "plotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import type { CompareSlot } from "../store";
import type { Category, SimulateResult, Snapshot, SweepResult } from "../types";

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
function percentileAt(fan: Record<string, number[]>, i: number, y: number): string | null {
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
    ...band("p25", "p75", "rgba(88,166,255,0.22)", "25–75%"),
    { x, y: fan.p50, type: "scatter", mode: "lines", name: "Median",
      line: { color: ACCENT, width: 2.5 }, hoverinfo: "skip" },
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
  result: SimulateResult; axisMode: "age" | "year";
  retirementMarker?: number | null; birthYear?: number; height?: number;
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
