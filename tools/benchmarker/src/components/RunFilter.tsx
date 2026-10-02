import type { RunFilter } from "../../shared/stats.ts";

const NAMES: Record<RunFilter, string> = { all: "All runs", complete: "Complete runs" };

interface Props {
  filter: RunFilter;
  onChange(filter: RunFilter): void;
}

/** The one switch for the whole app: every run, or only complete ones. On every page and tab. */
export function RunFilterSwitch({ filter, onChange }: Props) {
  return (
    <div className="run-filter" role="group" aria-label="Which runs">
      {(Object.keys(NAMES) as RunFilter[]).map((f) => (
        <button key={f} type="button" className="chip" data-filter={f} aria-pressed={filter === f} onClick={() => onChange(f)}>
          {NAMES[f]}
        </button>
      ))}
    </div>
  );
}

/** In place of content the switch hides entirely, with the way out. */
export function FilteredOut({ onShowAll }: { onShowAll(): void }) {
  return (
    <p className="filtered-out" data-filtered-out>
      <em>This content is not visible under current filter settings. <button type="button" className="link-button" onClick={onShowAll}>Show all</button></em>
    </p>
  );
}
