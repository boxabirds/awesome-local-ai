// The mark a run's record can put on it, the same everywhere: intervened (something was done to it by hand or by a
// watchdog; it stays in the figures, and its numbers are read with that in mind).
import type { Intervention } from "../../shared/types.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import type { Row, Story } from "../../shared/types.ts";
import { groupInterventions, interventionStory, interventionTip, interventionWhen } from "../../shared/runView.ts";
import { conversationHref, storyRunHref } from "../../shared/routes.ts";

/** A heavy asterisk, as for a result with a footnote: the one glyph for an intervention. No status icon or held-out
 * colour uses it, and it has no emoji form (a hand rendered as a yellow emoji). */
const MARK = "✱";

/** Where a mark leads: the conversation of the story it is about, filtered to its interventions (the story run's page
 * when the warehouse has no conversation for it). For a run's mark, its first story with one. No story: no link. */
export function interventionHref(run: Pick<Row, "pack" | "stack" | "runId" | "interventions" | "stories">, story?: string): string | undefined {
  const id = interventionStory(run, story);
  if (id === null) return undefined;
  const s: Story | undefined = run.stories.find((x) => Number(x.id) === Number(id));
  return s?.hasConversation ? conversationHref(run.pack, run.stack, run.runId, id, "intervention") : storyRunHref(run.pack, run.stack, run.runId, id);
}

/** "✱ intervened", with every intervention on hover; `compact` (a matrix cell) shows the asterisk alone. Nothing for none.
 * With `to` it is a link to where the interventions are told. Inside a link (a matrix cell) it isn't focusable itself:
 * the link is. */
export function InterventionMark({ list, compact = false, focusable = true, to }: { list: Intervention[]; compact?: boolean; focusable?: boolean; to?: string }) {
  if (!list.length) return null;
  const tip = interventionTip(list);
  const props = {
    className: `intervened${compact ? " compact" : ""}${to ? " intervened-link" : ""}`, "data-intervened": list.length, "data-tip": tip,
    "aria-label": `${list.length} intervention${list.length === 1 ? "" : "s"}: ${tip}`,
  };
  const body = <><span aria-hidden="true">{MARK}</span>{compact ? null : <span aria-hidden="true"> {GLOSSARY.intervened.name}</span>}</>;
  return to ? <a {...props} href={to}>{body}</a> : <span {...props} tabIndex={focusable ? 0 : undefined} role="img">{body}</span>;
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
