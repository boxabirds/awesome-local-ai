// Conversation text as the pages show it: verbatim, marked as the agent's own words, the search's hits marked, and
// folded at five lines behind a + button.
import { useState } from "react";
import { needsClamp, splitHighlights } from "../../../shared/conversation.ts";

/** Verbatim text from the agent's conversation: a result, marked as such; what matches the search is marked too. */
export function Quoted({ text, className, query, block }: { text: string; className?: string; query?: string; block?: boolean }) {
  const runs = splitHighlights(text, query ?? "");
  const body = runs.map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : r.text));
  return block ? <pre className={`quoted ${className ?? ""}`} data-quoted="agent">{body}</pre> : <span className={`quoted ${className ?? ""}`} data-quoted="agent">{body}</span>;
}

/** A cell of conversation text: five lines, then a + button for the whole of what the page holds. */
export function Clamped({ text, query, mono, block }: { text: string; query?: string; mono?: boolean; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const fold = needsClamp(text);
  return (
    <div className="clamp-cell">
      <div className={`clamp${mono ? " mono" : ""}`} data-expanded={fold && open ? "true" : "false"} data-folded={fold && !open ? "true" : undefined}>
        <Quoted text={text} query={query} block={block} />
      </div>
      {fold ? <button type="button" className="clamp-more" aria-expanded={open} aria-label={open ? "Show less" : "Show all"} onClick={() => setOpen((o) => !o)}>{open ? "−" : "+"}</button> : null}
    </div>
  );
}
