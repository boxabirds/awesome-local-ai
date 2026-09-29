import type { RunStatus } from "../../shared/types.ts";

interface Props {
  counts: [RunStatus, number][];
  hidden: Set<RunStatus>;
  onChange(hidden: Set<RunStatus>): void;
}

/** A toggle per status present, with its count; plus "only running" and "all". */
export function StatusFilter({ counts, hidden, onChange }: Props) {
  const toggle = (s: RunStatus) => {
    const next = new Set(hidden);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange(next);
  };
  const only = (s: RunStatus) => onChange(new Set(counts.map(([c]) => c).filter((c) => c !== s)));
  return (
    <div className="status-filter" role="group" aria-label="Status">
      {counts.map(([s, n]) => (
        <button key={s} type="button" className={`chip s-${s}`} aria-pressed={!hidden.has(s)} onClick={() => toggle(s)}>
          {s} {n}
        </button>
      ))}
      <button type="button" className="chip link" onClick={() => only("running")}>only running</button>
      <button type="button" className="chip link" onClick={() => onChange(new Set())}>all</button>
    </div>
  );
}
