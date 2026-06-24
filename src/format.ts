// Currency and percent formatting — the single source of truth for number display.
// UI components re-export fmtMoney/fmtPct from here so existing call sites that
// import them from "./components/ui" keep working.

/** Currency, e.g. $1,234. Null/non-finite → em dash. `digits` caps decimals. */
export const fmtMoney = (v: number | null | undefined, digits = 0): string =>
  v == null || !isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", {
        style: "currency", currency: "USD",
        maximumFractionDigits: digits, minimumFractionDigits: 0,
      });

/** Percent of a fraction, e.g. 0.05 → "5.0%". Null/non-finite → em dash. */
export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

/** Compact currency for chart tooltips, where the value is always finite. */
export const fmtTipMoney = (v: number): string => fmtMoney(v);
