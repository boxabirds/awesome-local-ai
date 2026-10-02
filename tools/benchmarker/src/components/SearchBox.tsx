import { useEffect, useMemo, useRef, useState } from "react";
import { buildSearchIndex, searchIndex, type SearchMatch } from "../../shared/search.ts";
import type { State } from "../../shared/types.ts";

interface Props {
  state: Pick<State, "rows" | "machines">;
}

/** `title` or `subtitle` with its matched ranges wrapped in <mark>, for the live results list. */
function marked(text: string, ranges: [number, number][]) {
  if (!ranges.length) return text;
  const parts: (string | { mark: string; key: number })[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(text.slice(at, from));
    if (to > at) parts.push({ mark: text.slice(Math.max(at, from), to), key: i });
    at = Math.max(at, to);
  });
  if (at < text.length) parts.push(text.slice(at));
  return parts.map((p) => (typeof p === "string" ? p : <mark key={p.key}>{p.mark}</mark>));
}

/** Every combination, run, story and machine: press / to focus, results as you type, grouped by section (the
 * app's own Combinations / Runs / Stories / Machines) and ranked by relevance inside each. Mirrors the benchmark
 * guide's own search: focus key, live results, bolded matches in context, keyboard-navigable. */
export function SearchBox({ state }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildSearchIndex(state), [state]);
  const groups = useMemo(() => searchIndex(index, query), [index, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.matches), [groups]);

  useEffect(() => {
    setSel(0);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".search-box")) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const go = (m: SearchMatch) => {
    setOpen(false);
    setQuery("");
    location.hash = m.item.href;
  };

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="search"
        placeholder="Search (press /)"
        aria-label="Search"
        role="combobox"
        aria-expanded={open && flat.length > 0}
        aria-controls="search-results"
        aria-activedescendant={open && flat.length ? `sr-${sel}` : undefined}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (query) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || !flat.length) {
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % flat.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + flat.length) % flat.length); }
          else if (e.key === "Enter") { e.preventDefault(); go(flat[sel]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      />
      {open && query.trim() && (
        <div className="search-results" id="search-results" ref={boxRef}>
          {flat.length === 0
            ? <p className="search-empty">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
            : (
              <ul role="listbox" aria-label="Search results">
                {groups.map((g) => (
                  <li key={g.section} role="presentation" className="search-group">
                    <p className="search-section">{g.section}</p>
                    <ul role="presentation">
                      {g.matches.map((m) => {
                        const i = flat.indexOf(m);
                        return (
                          <li key={m.item.id} role="presentation">
                            <a
                              role="option"
                              id={`sr-${i}`}
                              aria-selected={i === sel}
                              href={m.item.href}
                              onMouseEnter={() => setSel(i)}
                              onClick={(e) => { e.preventDefault(); go(m); }}
                            >
                              <span className="r-title">{marked(m.item.title, m.titleMarks)}</span>
                              <span className="r-sub">{marked(m.item.subtitle, m.subtitleMarks)}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
