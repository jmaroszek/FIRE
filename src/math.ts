// Small statistical helpers shared across tabs and charts. One implementation
// each, so a fix or rounding-convention change propagates everywhere.

/** Median of a list (mean of the two middle values for even n). 0 for empty. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The p-th percentile (0–100) by nearest-rank on the sorted sample. 0 for empty. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

/** Round a raw step up to a "nice" 1 / 2 / 2.5 / 5 × 10ⁿ value, so histogram bin
 *  edges land on natural round numbers (… 250k, 500k, 1M …) instead of 437k. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** Estimate which percentile of outcomes a dollar value sits at, by linear
 *  interpolation between the fan's percentile curves at one time step. */
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
