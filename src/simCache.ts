// Lightweight localStorage cache for deterministic engine results.
//
// The engine is seeded, so every analysis is a pure function of its request
// body (see the cohesion refactor's "byte-identical output" note). Caching by a
// hash of that body lets a reopened app paint plots from the last run instead of
// recomputing the whole Monte Carlo each time — an unchanged profile never hits
// the server twice.
//
// Two version stamps fold into every key so cached numbers can never outlive the
// code that produced them:
//   • SCHEMA_VERSION — set from /health at startup; guards scenario-shape changes.
//   • CACHE_VERSION  — bumped BY HAND below whenever engine MATH changes without a
//     schema bump. Without this, a logic-only change would keep serving stale
//     results until the user happened to edit the scenario.
// Bump CACHE_VERSION whenever you change the engine in a way that alters outputs
// for an unchanged scenario.
const CACHE_VERSION = 1;

const PREFIX = "fire:sc:";
const INDEX_KEY = "fire:sc:index";
const MAX_ENTRIES = 24; // a handful of scenarios × the analyses each one runs

let schemaVersion = 0;
/** Fold the engine's schema version into every key (called once at startup). */
export const setCacheSchemaVersion = (v: number): void => { schemaVersion = v; };

const hasStorage = (): boolean => {
  try { return typeof localStorage !== "undefined"; } catch { return false; }
};

// cyrb53 — fast, well-distributed 53-bit string hash. More than enough to key a
// local cache; collisions across our handful of inputs are astronomically rare.
function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const keyFor = (tag: string, input: unknown): string =>
  PREFIX + tag + ":" + hash(`${CACHE_VERSION}|${schemaVersion}|${JSON.stringify(input)}`);

function readIndex(): string[] {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]"); } catch { return []; }
}
function writeIndex(idx: string[]): void {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* ignore */ }
}

/** Cached value for (tag, input), or null on a miss / unavailable storage. */
export function getCached<T>(tag: string, input: unknown): T | null {
  if (!hasStorage()) return null;
  try {
    const raw = localStorage.getItem(keyFor(tag, input));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

/** Store value for (tag, input). Best-effort: evicts the oldest entries when the
 *  cap or the storage quota is hit, and silently gives up if it still can't fit
 *  (we just recompute next time — never a correctness problem). */
export function putCached(tag: string, input: unknown, value: unknown): void {
  if (!hasStorage()) return;
  const key = keyFor(tag, input);
  let payload: string;
  try { payload = JSON.stringify(value); } catch { return; }

  const idx = readIndex().filter((k) => k !== key);
  idx.push(key); // most-recently-used at the tail

  const write = (): void => {
    while (idx.length > MAX_ENTRIES) {
      const old = idx.shift();
      if (old) localStorage.removeItem(old);
    }
    localStorage.setItem(key, payload);
    writeIndex(idx);
  };

  try {
    write();
  } catch {
    // Quota exceeded — drop the oldest half and try once more, then give up.
    try {
      idx.splice(0, Math.ceil(idx.length / 2)).forEach((k) => localStorage.removeItem(k));
      write();
    } catch { /* not cacheable; recompute next time */ }
  }
}
