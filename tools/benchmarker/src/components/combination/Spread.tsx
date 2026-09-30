// A median over runs with its range and n: "63 (58–68) n=3". One run has no range to show.
import type { Spread } from "../../../shared/stats.ts";
import { short } from "../UsageCells.tsx";

const HOUR_DECIMALS = 1;
export const fmtHours = (h: number) => h.toFixed(HOUR_DECIMALS);
export const fmtTokens = (n: number) => short(Math.round(n));
export const fmtCount = (n: number) => String(Math.round(n));

export function SpreadText({ s, fmt, big, showN }: { s: Spread; fmt: (n: number) => string; big?: string; showN?: boolean }) {
  const ranged = s.min !== s.max;
  return (
    <span className="spread" data-n={s.n}>
      <span className={`median ${big ?? "num"}`}>{fmt(s.median)}</span>
      {ranged ? <span className="range"> ({fmt(s.min)}–{fmt(s.max)})</span> : null}
      {showN ? <span className="n"> n={s.n}</span> : null}
    </span>
  );
}
