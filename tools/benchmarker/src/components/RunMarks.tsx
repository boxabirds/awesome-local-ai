// The mark a run's record can put on it, the same everywhere: intervened (something was done to it by hand or by a
// watchdog; it stays in the figures, and its numbers are read with that in mind).
import type { Intervention } from "../../shared/types.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import type { Row, Story } from "../../shared/types.ts";
import { groupInterventions, interventionCount, interventionStory, interventionTip, interventionWhen } from "../../shared/runView.ts";
import { conversationHref, runHref, storyRunHref, withParams } from "../../shared/routes.ts";

/** A heavy asterisk, as for a result with a footnote: the one glyph for an intervention. No status icon or held-out
 * colour uses it, and it has no emoji form (a hand rendered as a yellow emoji). */
const MARK = "✱";

/** Where a story's mark leads: that story's conversation, filtered to its interventions (its story run page when the
 * warehouse has no conversation for it). A run's mark leads to the run page's own list of them all, which it scrolls
 * to. No story and no interventions: no link. */
export function interventionHref(run: Pick<Row, "pack" | "stack" | "runId" | "interventions" | "stories">, story?: string): string | undefined {
  if (story === undefined) {
    return (run.interventions ?? []).length ? withParams(runHref(run.pack, run.stack, run.runId), { at: INTERVENTIONS_SECTION }) : undefined;
  }
  const id = interventionStory(run, story);
  if (id === null) return undefined;
  const s: Story | undefined = run.stories.find((x) => Number(x.id) === Number(id));
  return s?.hasConversation ? conversationHref(run.pack, run.stack, run.runId, id, "intervention") : storyRunHref(run.pack, run.stack, run.runId, id);
}

/** The run page's interventions section: its id, and the `at` the run's mark asks the page to scroll to. */
export const INTERVENTIONS_SECTION = "interventions";

/** "✱ intervened", with every intervention on hover; `compact` (a matrix cell) shows the asterisk alone. Nothing for none.
 * With `to` it is a link to where the interventions are told. Inside a link (a matrix cell) it isn't focusable itself:
 * the link is. */
export function InterventionMark({ list, compact = false, focusable = true, to }: { list: Intervention[]; compact?: boolean; focusable?: boolean; to?: string }) {
  if (!list.length) return null;
  const tip = interventionTip(list);
  const count = interventionCount(list);          // the guard firing twice on one silent call is one intervention
  const props = {
    className: `intervened${compact ? " compact" : ""}${to ? " intervened-link" : ""}`, "data-intervened": count, "data-tip": tip,
    "aria-label": `${count} intervention${count === 1 ? "" : "s"}: ${tip}`,
  };
  const body = <><span aria-hidden="true">{MARK}</span>{compact ? null : <span aria-hidden="true"> {GLOSSARY.intervened.name}</span>}</>;
  return to ? <a {...props} href={to}>{body}</a> : <span {...props} tabIndex={focusable ? 0 : undefined} role="img">{body}</span>;
}

/** The run page's list of every intervention, oldest first, repeats shown once with how many times, each in the
 * page's own words (shared/runView.ts's interventionText). */
export function InterventionList({ list, run }: { list: Intervention[]; run?: Pick<Row, "pack" | "stack" | "runId" | "interventions" | "stories"> }) {
  return (
    <ol className="intervention-list">
      {groupInterventions(list).map((g, i) => {
        const to = run && g.story !== null ? interventionHref(run, g.story) : undefined;
        const where = g.story === null ? "the run" : `story ${g.story}`;
        return (
          <li key={i} data-story={g.story ?? "run"}>
            <span className="mono small">{interventionWhen(g)}</span>{" "}
            <b>{to ? <a href={to}>{where}</a> : where}</b>: {g.text}{g.count > 1 ? <span className="small"> ({g.count} times)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** "collapsed" on a story run in a stretch of three or more in a row that pass none (shared/collapse.ts). A fact with what it
 * means on hover; nothing for any other story run. */
export function CollapsedMark({ story }: { story: Pick<Story, "collapsed"> | undefined }) {
  if (!story?.collapsed) return null;
  return <span className="collapsed-mark" data-tip={GLOSSARY.collapsed.what} tabIndex={0}>{GLOSSARY.collapsed.name}</span>;
}
