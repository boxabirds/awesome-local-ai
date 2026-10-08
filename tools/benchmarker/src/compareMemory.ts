// What the reader chose to compare runs with, remembered in this browser so the next run page starts where the last one
// ended. Stored as run keys (combination and run id), so it applies on any run page. A private window or a blocked store
// remembers nothing and the page works the same without it.
const RUNS_KEY = "benchmarker.compare.runs";
const REMEMBER_KEY = "benchmarker.compare.remember";

export function readRemember(): boolean {
  try { return localStorage.getItem(REMEMBER_KEY) !== "off"; } catch { return true; }
}

export function writeRemember(on: boolean): void {
  try { localStorage.setItem(REMEMBER_KEY, on ? "on" : "off"); if (!on) localStorage.removeItem(RUNS_KEY); } catch { /* not remembered */ }
}

export function readRemembered(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function writeRemembered(keys: string[]): void {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(keys)); } catch { /* not remembered */ }
}
