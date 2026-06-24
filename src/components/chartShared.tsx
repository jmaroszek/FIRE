// Shared chart infrastructure: the Plotly wrapper, dark theme, the semantic
// color system, axis/format helpers, and life-stage markers. The single source
// of truth for how every chart looks, so a theming or palette change lands once.

import React, { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { Config, Layout, Shape } from "plotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import type { SimulateResult } from "../types";

const RawPlot = createPlotlyComponent(Plotly);

/** Wraps react-plotly so each chart resizes to its CONTAINER, not just the window.
 * Plotly's `responsive: true` only listens for window resizes; but our auto-fit grids
 * (`repeat(auto-fit, minmax(...))`) reflow their column count on window maximize/restore,
 * which changes a tile's width WITHOUT a window resize Plotly reacts to in time — leaving
 * the chart stuck at a stale width until a remount (which is why swapping tabs "fixes" it).
 * A ResizeObserver on the wrapping div catches the real element resize whatever its cause.
 * onInitialized/onUpdate are forwarded so callers (e.g. FanChart's hover) still get the gd. */
export function Plot(props: React.ComponentProps<typeof RawPlot>) {
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
export const ACCENT = "#58a6ff";

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

export const config: Partial<Config> = { displayModeBar: false, responsive: true };

export function xValues(result: SimulateResult, axisMode: "age" | "year", extraPoint = true): number[] {
  const base = axisMode === "age" ? result.ages : result.years;
  // fan series have T+1 points ([0] = today); ages/years have T
  return extraPoint ? [base[0] - 1, ...base] : [...base];
}

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

export const SOURCE_COLORS: Record<string, string> = {
  cash: FLOW_COLORS.cash,
  taxable: FLOW_COLORS.taxable,
  roth_basis: FLOW_COLORS.roth_basis,
  roth_matured_conversions: FLOW_COLORS.roth_matured_conversions,
  trad: FLOW_COLORS.trad,
  hsa: FLOW_COLORS.hsa,
  roth_earnings: FLOW_COLORS.roth_earnings,
};

export const POOL_COLORS: Record<string, string> = {
  taxable: FLOW_COLORS.taxable, trad: FLOW_COLORS.trad, roth: FLOW_COLORS.roth,
  hsa: FLOW_COLORS.hsa, cash: FLOW_COLORS.cash,
};
export const POOL_ORDER = ["taxable", "trad", "roth", "hsa", "cash"];

// Contribution-flow labels/colors (employer match + the destination pools);
// shared by the account-flows and annual-tax charts.
export const CONTRIB_LABELS: Record<string, string> = {
  match: "Employer Match", trad: "Traditional", roth: "Roth", hsa: "HSA",
  taxable: "Brokerage", cash: "Cash",
};
export const CONTRIB_COLORS: Record<string, string> = {
  match: FLOW_COLORS.match, trad: FLOW_COLORS.trad, roth: FLOW_COLORS.roth,
  hsa: FLOW_COLORS.hsa, taxable: FLOW_COLORS.taxable, cash: FLOW_COLORS.cash,
};

export type YFmt = "money" | "percent" | "multiplier";
export const yTick = (f: YFmt) => (f === "money" ? "$.3~s" : f === "percent" ? ".0%" : ".2f");
export const yHover = (f: YFmt) => (f === "money" ? "%{y:$,.0f}" : f === "percent" ? "%{y:.1%}" : "%{y:.2f}×");

export interface LifeMark { age: number; label: string; color?: string }

/** Dashed vertical guides at life-stage ages (retire / 59½ / 65 / 75 / SS), so
 * every time-axis chart marks the same milestones consistently instead of each
 * reinventing them. Converts age→x for the active axis mode. */
export function lifeStageMarkers(axisMode: "age" | "year", birthYear: number | undefined,
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
