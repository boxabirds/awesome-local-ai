// What differed: this story run beside one other run of the same story in the combination, figure by figure, with
// this run's figure over the other's. It starts with the most typical other run (the medoid: the rule is in the
// glossary); any other can be chosen, and the choice is kept in the address (?compare=v2-r4). The rows and every
// missing figure's why come from whatDiffered; this only lays them out.
import type { ReactNode } from "react";
import type { Row, State, Story } from "../../../shared/types.ts";
import { againstCombination, whatDiffered, type DifferGroup, type DifferRow, type DifferSide, type DifferUnit } from "../../../shared/runView.ts";
import type { TermId } from "../../../shared/glossary.ts";
import { StoryRunLink } from "../EntityLinks.tsx";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Term, full } from "./bits.tsx";
import { speed } from "./RunCost.tsx";
import { useAddressParam } from "../story/useAddressParam.ts";

const GROWTH_DECIMALS = 1;
const RATIO_DECIMALS = 1;
/** From 10× up a ratio is shown whole; below 1, to two significant figures (0.064×, not 0.1×). */
const WHOLE_RATIO = 10;
const SMALL_RATIO_FIGURES = 2;

/** 4.811 -> "4.8×", 28.8 -> "29×", 0.0641 -> "0.064×". */
export function ratioText(r: number): string {
  if (r >= WHOLE_RATIO) return `${Math.round(r)}×`;
  if (r >= 1) return `${r.toFixed(RATIO_DECIMALS)}×`;
  return `${Number(r.toPrecision(SMALL_RATIO_FIGURES))}×`;
}

const SHOW: Record<Exclude<DifferUnit, "passRate">, (n: number) => string> = {
  seconds: duration, tokens: short, count: full, chars: full, tokS: speed, times: (n) => `${n.toFixed(GROWTH_DECIMALS)}×`,
};

/** Each group's heading; the outcome (one row, held-out) needs none. */
const GROUP_TERM: Partial<Record<DifferGroup, TermId>> = { cost: "cost", time: "timeSplit", conversation: "conversation" };

const NO_PROFILE = "it was recorded before the harness kept one, or its client's log can't be read.";
const NO_RATIO = "No ratio without both conversation profiles.";

function Value({ row, side, story, which }: { row: DifferRow; side: DifferSide; story: Story; which: "a" | "b" }) {
  if (side.value === null) return <td className={`n ${which}`}><Missing why={side.why ?? "Not recorded for this story run."} /></td>;
  const text = row.unit === "passRate" ? `${story.ownPassed ?? 0}/${story.ownTotal}` : SHOW[row.unit](side.value);
  return <td className={`n ${which}`}>{text}</td>;
}

function Ratio({ row }: { row: DifferRow }) {
  return <td className="n ratio">{row.ratio !== null ? ratioText(row.ratio) : <Missing why={row.ratioWhy ?? "No ratio."} />}</td>;
}

function Label({ row }: { row: DifferRow }) {
  if (row.label === null) return <th scope="row"><Term id={row.term} /></th>;
  return <th scope="row" className="sub"><Term id={row.term}><span className="mono">{row.label}</span>{row.key.startsWith("tool:") ? " calls" : ""}</Term></th>;
}

/** The conversation's rows. A side without a profile says so once, down its whole column; with neither, one line. */
function ConversationRows({ rows, a, b, thisRun, other }: { rows: DifferRow[]; a: Story; b: Story; thisRun: Row; other: Row }) {
  const hasA = !!a.conversation, hasB = !!b.conversation;
  if (!hasA && !hasB) {
    return <tr data-row="no-profile"><td colSpan={4} className="no-profile" data-side="both">Neither story run has a conversation profile: each was recorded before the harness kept one, or its client's log can't be read.</td></tr>;
  }
  const span = rows.length;
  const none = (run: Row, which: "a" | "b") => <td rowSpan={span} className="no-profile" data-side={which}>{run.runId} has no conversation profile for this story: {NO_PROFILE}</td>;
  return <>{rows.map((r, i) => (
    <tr key={r.key} data-row={r.key} data-group={r.group} data-differs={r.differs ? "true" : undefined}>
      <Label row={r} />
      {hasA ? <Value row={r} side={r.a} story={a} which="a" /> : i === 0 ? none(thisRun, "a") : null}
      {hasB ? <Value row={r} side={r.b} story={b} which="b" /> : i === 0 ? none(other, "b") : null}
      {hasA && hasB ? <Ratio row={r} /> : i === 0 ? <td rowSpan={span} className="n ratio"><Missing why={NO_RATIO} /></td> : null}
    </tr>
  ))}</>;
}

export function WhatDiffered({ run, state, storyId, params }: { run: Row; state: State; storyId: string; params?: Record<string, string> }) {
  const [param, setParam] = useAddressParam(params, "compare");
  const { entries, typical } = againstCombination(run, state.rows, storyId);
  const mine = entries.find((e) => e.isThis)?.story ?? null;
  if (!mine) return null;
  const options = entries.filter((e) => !e.isThis && e.story);
  if (!options.length) {
    return (
      <Section term="whatDiffered" id="differed">
        <p className="rp-empty">No other run of this combination has recorded story {storyId}, so there is nothing to compare it with.</p>
      </Section>
    );
  }
  const asked = param ? options.find((e) => e.run.runId === param) ?? null : null;
  const chosen = asked ?? (typical ? options.find((e) => e.run.runId === typical.run.runId)! : null);
  const selectId = "differ-with";
  const aside = (
    <label className="compare-pick" htmlFor={selectId}>
      compare with{" "}
      <select id={selectId} value={chosen?.run.runId ?? ""} onChange={(e) => setParam(e.target.value || undefined)}>
        {chosen ? null : <option value="">choose a run…</option>}
        {options.map((e) => (
          <option key={e.run.runId} value={e.run.runId}>
            {e.run.runId}{e.run.runId === typical?.run.runId ? " · most typical" : ""}{e.run.invalid ? " · invalid" : ""}
          </option>
        ))}
      </select>
    </label>
  );
  const notes: ReactNode[] = [];
  if (param && !asked) notes.push(<p key="unknown" className="small" data-unknown={param}>The address names {param}, which hasn't recorded story {storyId} in this combination; showing the most typical run instead.</p>);
  if (!chosen) {
    return (
      <Section term="whatDiffered" id="differed" aside={aside}>
        {notes}
        <p className="rp-empty">Every other run that recorded this story is invalid, so none is the most typical. Choose one to compare with anyway.</p>
      </Section>
    );
  }
  const other = chosen.run, theirs = chosen.story!;
  const { rows } = whatDiffered(mine, theirs);
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Section term="whatDiffered" id="differed" aside={aside}>
      {notes}
      <p className="small differ-key">
        {chosen.run.runId === typical?.run.runId
          ? <>Beside the <Term id="typicalRun" /> other run of this story, {other.runId}.</>
          : <>Beside {other.runId}{typical ? <>; the <Term id="typicalRun" /> other run is {typical.run.runId}</> : null}.</>}
        {" "}Where the two are more than 10% apart, the ratio is in bold.
      </p>
      <div className="table-scroll">
        <table className="rp-table differ" aria-label={`Story ${storyId}: ${run.runId} beside ${other.runId}`}>
          <thead>
            <tr>
              <th>Figure</th>
              <th className="n">this story run <span className="run-id">{run.runId}</span></th>
              <th className="n"><StoryRunLink pack={other.pack} stack={other.stack} runId={other.runId} story={storyId} invalid={other.invalid}>{other.runId}</StoryRunLink></th>
              <th className="n"><Term id="ratioThisOverOther" /></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const inGroup = rows.filter((r) => r.group === g);
              const term = GROUP_TERM[g];
              return [
                term ? <tr key={`h-${g}`} className="group-row" data-group-head={g}><th colSpan={4} scope="colgroup"><Term id={term} /></th></tr> : null,
                g === "conversation"
                  ? <ConversationRows key="conversation" rows={inGroup} a={mine} b={theirs} thisRun={run} other={other} />
                  : inGroup.map((r) => (
                    <tr key={r.key} data-row={r.key} data-group={r.group} data-differs={r.differs ? "true" : undefined}>
                      <Label row={r} />
                      <Value row={r} side={r.a} story={mine} which="a" />
                      <Value row={r} side={r.b} story={theirs} which="b" />
                      <Ratio row={r} />
                    </tr>
                  )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
