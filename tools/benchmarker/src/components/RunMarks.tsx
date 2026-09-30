// The two marks a run's record can put on it, the same everywhere: invalid (struck through, left out of every figure,
// and said at the top of its pages) and intervened (someone did something to it by hand; it stays in the figures).
import type { Intervention, Invalid } from "../../shared/types.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { groupInterventions, interventionTip, interventionWhen, invalidTip } from "../../shared/runView.ts";

/** A heavy asterisk, as for a result with a footnote: the one glyph for an intervention. No status icon or held-out
 * colour uses it, and it has no emoji form (a hand rendered as a yellow emoji). */
const MARK = "\u2731";

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

/** "invalid", where a figure would be: the reason on hover. */
export function InvalidTag({ invalid }: { invalid: Invalid }) {
  return <span className="invalid-tag" tabIndex={0} data-tip={invalidTip(invalid)} data-invalid="true">{GLOSSARY.invalidRun.name.toLowerCase()}</span>;
}

/** At the top of an invalid run's pages: that it is invalid, why, since when, and what that does to its numbers. */
export function InvalidBanner({ invalid, what }: { invalid: Invalid | null; what: "run" | "story run" }) {
  if (!invalid) return null;
  return (
    <div className="invalid-banner" role="note" data-section="invalid">
      <b>{what === "run" ? "This run is invalid" : "This story run belongs to an invalid run"}:</b> {invalid.reason}
      {invalid.since ? <span className="small"> (marked {invalid.since})</span> : null}.{" "}
      <span className="small">Its numbers are shown for the record, but they are left out of every figure: rankings, medians, ranges, pooled scores, divergence medians and needs you.</span>
    </div>
  );
}

/** The run page's list of every intervention, oldest first, repeats shown once with how many times. */
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
