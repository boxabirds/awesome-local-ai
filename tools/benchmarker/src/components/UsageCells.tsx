const K = 1000;
const M = 1_000_000;

/** 55968 -> "56k", 6230043 -> "6.2M". */
export function short(n: number | null): string {
  if (n === null) return "—";
  if (n >= M) return `${(n / M).toFixed(1)}M`;
  if (n >= K) return `${Math.round(n / K)}k`;
  return String(n);
}
