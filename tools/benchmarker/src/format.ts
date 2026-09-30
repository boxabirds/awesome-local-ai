// Small formatting helpers shared by the components.

export function ago(seconds: number | null): string {
  if (seconds === null) return "never";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${(s / 3600).toFixed(1)} h ago`;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** A length of time, short: "45 s", "12 min", "1h08m", "2.3 d". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < MINUTE) return `${s} s`;
  if (s < HOUR) return `${Math.round(s / MINUTE)} min`;
  if (s < DAY) return `${Math.floor(s / HOUR)}h${String(Math.floor((s % HOUR) / MINUTE)).padStart(2, "0")}m`;
  return `${(s / DAY).toFixed(1)} d`;
}

const HIGH = 0.95;
const MID = 0.8;
/** How good a pass rate is, as a class: green at 95% and up, amber at 80% and up, red below. */
export const qualityClass = (frac: number | null) => (frac === null ? "" : frac >= HIGH ? "q-high" : frac >= MID ? "q-mid" : "q-low");

export function ordinal(n: number): string {
  const teen = n % 100 > 10 && n % 100 < 14;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Workspace paths in the agent's latest action are long and all alike: keep the part after /workspace/. */
const WORKSPACE_PATH = /\S*\/workspace\//g;
export const shortAction = (s: string) => s.replace(WORKSPACE_PATH, "");
