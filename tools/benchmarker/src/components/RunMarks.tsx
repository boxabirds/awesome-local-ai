// The mark a run's record can put on it, the same everywhere: intervened (something was done to it by hand or by a
// watchdog; it stays in the figures, and its numbers are read with that in mind).
import type { Intervention } from "../../shared/types.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { groupInterventions, interventionTip, interventionWhen } from "../../shared/runView.ts";

/** A heavy asterisk, as for a result with a footnote: the one glyph for an intervention. No status icon or held-out
 * colour uses it, and it has no emoji form (a hand rendered as a yellow emoji). */
const MARK = "✱";

/** "✱ intervened", with every intervention on hover; `compact` (a matrix cell) shows the asterisk alone. Nothing for none.
 * Inside a link (a matrix cell) it isn't focusable itself: the link is. */
export function InterventionMark({ list, compact = false, focusable = true }: { list: Intervention[]; compact?: boolean; focusable?: boolean }) {
  if (!list.length) return null;
  const tip = interventionTip(list);
  return (
    <span className={`intervened${compact ? " compact" : ""}`} data-intervened={list.length} data-tip={tip} tabIndex={focusable ? 0 : undefined}
      role="img" aria-label={`${list.length} intervention${list.length === 1 ? "" : "s"}: ${tip}`}>
      <span aria-hidden="true">{MARK}</span>{compact ? null : <span aria-hidden="true"> {GLOSSARY.intervened.name}</span>}
    </span>
  );
}

/** The run page's list of every intervention, oldest first, repeats shown once with how many times, each in the
 * page's own words (shared/runView.ts's interventionText). */
export function InterventionList({ list }: { list: Intervention[] }) {
  return (
    <ol className="intervention-list">
      {groupInterventions(list).map((g, i) => (
        <li key={i} data-story={g.story ?? "run"}>
          <span className="mono small">{interventionWhen(g)}</span>{" "}
          <b>{g.story === null ? "the run" : `story ${g.story}`}</b>: {g.text}{g.count > 1 ? <span className="small"> ({g.count} times)</span> : null}
        </li>
      ))}
    </ol>
  );
}
