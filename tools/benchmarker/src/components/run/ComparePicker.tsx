// Choosing the runs a run is compared with: a search box that suggests runs as you type, and the runs chosen so far as a
// list, each removable. A combobox as the ARIA pattern has it: the input keeps focus, the arrow keys move through the
// suggestions, Enter adds one, Escape closes them.
import { useId, useMemo, useState } from "react";
import type { Row } from "../../../shared/types.ts";
import { matchRuns, runKey } from "../../../shared/compareList.ts";
import { statusView } from "../../../shared/runView.ts";

/** Suggestions drawn at once; the rest are reached by typing more. */
const MAX_SUGGESTIONS = 50;

export interface ComparePickerProps {
  candidates: Row[];
  chosen: Row[];
  onAdd: (run: Row) => void;
  onRemove: (run: Row) => void;
  remember: boolean;
  onRemember: (on: boolean) => void;
}

export function ComparePicker({ candidates, chosen, onAdd, onRemove, remember, onRemember }: ComparePickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const taken = useMemo(() => new Set(chosen.map(runKey)), [chosen]);
  const matches = useMemo(() => matchRuns(candidates, query, taken), [candidates, query, taken]);
  const shown = matches.slice(0, MAX_SUGGESTIONS);
  const optionId = (r: Row) => `${id}-o-${runKey(r)}`;
  const activeRun = open ? shown[Math.min(active, shown.length - 1)] : undefined;

  const add = (run: Row) => { onAdd(run); setQuery(""); setActive(0); setOpen(false); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(shown.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && activeRun) { e.preventDefault(); add(activeRun); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="compare-picker">
      {chosen.length ? (
        <ul className="compare-chips" aria-label="Runs compared with">
          {chosen.map((r) => (
            <li key={runKey(r)} data-run={r.runId} data-stack={r.stack}>
              <span className="chip-id">{r.runId}</span> <span className="small">{r.label}</span>
              <button type="button" className="chip-remove" aria-label={`Remove ${r.runId} (${r.label})`} onClick={() => onRemove(r)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="compare-search">
        <label htmlFor={`${id}-input`}>Add a run</label>
        <input
          id={`${id}-input`} type="text" role="combobox" autoComplete="off" spellCheck={false}
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeRun ? optionId(activeRun) : undefined}
          placeholder="search by run, model, engine or machine"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {open ? (
          <ul id={listId} role="listbox" aria-label="Runs to add" className="compare-suggestions">
            {shown.length === 0 ? <li className="small compare-none" role="presentation">No run matches.</li> : null}
            {shown.map((r, i) => {
              const v = statusView(r);
              return (
                <li key={runKey(r)} id={optionId(r)} role="option" aria-selected={r === activeRun} data-run={r.runId} data-stack={r.stack} data-status={v.status}
                  className={r === activeRun ? "active" : undefined}
                  // mousedown, not click: the input would lose focus and close the list before a click landed
                  onMouseDown={(e) => { e.preventDefault(); add(r); }} onMouseEnter={() => setActive(i)}>
                  <span className="chip-id">{r.runId}</span> <span className={`status-word s-${v.status}`}>{v.status}</span>
                  <span className="small"> · {r.label} · {r.machine || "machine unknown"} · {r.stories.length} {r.stories.length === 1 ? "story" : "stories"}</span>
                </li>
              );
            })}
            {matches.length > shown.length ? <li className="small compare-none" role="presentation">{matches.length - shown.length} more: keep typing to narrow them.</li> : null}
          </ul>
        ) : null}
      </div>
      <label className="compare-remember small">
        <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} /> remember these runs in this browser
      </label>
    </div>
  );
}
