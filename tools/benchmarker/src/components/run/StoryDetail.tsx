// One story run in detail: where its time went, part by part; what it cost; and what the conversation looked like.
import type { Story, TimeSplit, Usage } from "../../../shared/types.ts";
import { conversationView, splitParts, toolKinds, whyMissing } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { checkView, lower, type CheckRun, type CheckView } from "../../../shared/accountingView.ts";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, Section, Stat, Term, full } from "./bits.tsx";
import { CheckMark, SegmentLegend, SplitBar } from "./SplitBar.tsx";
import { pct, speed } from "./RunCost.tsx";

const RATIO_DECIMALS = 1;

const secs = (s: number) => `${full(s)} s`;

/** The check's verdict, beside the parts: the word for it, and what it means. */
function CheckVerdict({ check, run, v }: { check: TimeSplit["check"]; run: CheckRun; v: CheckView }) {
  return (
    <div className="check" data-check={check.status}>
      <div className="stat-label"><Term id="accountingCheck" /></div>
      {check.status === "ok" ? <span className="ok-text">✓ passed: the parts add up</span>
        : check.status === "unchecked" ? <span><CheckMark check={check} run={run} /> not checked</span>
        : <span className="bad-text"><CheckMark check={check} run={run} /> failed</span>}
      {check.status === "ok" ? <p className="check-meaning">{v.meaning}</p> : null}
    </div>
  );
}

/** A check that failed or was never made, said in full under the parts: what it means, each problem in words with
 * the harness's own sentence beside it, the likely cause, and what to do. */
function CheckExplain({ v }: { v: CheckView }) {
  return (
    <div className="check-explain" data-explain={v.status}>
      <p className="check-meaning">{v.meaning}</p>
      {v.problems.length ? (
        <ul className="problems">
          {v.problems.map((p) => <li key={p.raw} data-kind={p.kind}><span className="problem-text">{p.text}</span> <span className="problem-raw mono" title="as the harness recorded it">{p.raw}</span></li>)}
        </ul>
      ) : null}
      {v.cause ? <p className="check-cause"><b>Likely cause:</b> {lower(v.cause)}</p> : null}
      <p className="check-todo"><b>What to do:</b> {lower(v.todo)}</p>
      {v.command ? <code className="check-command">{v.command}</code> : null}
    </div>
  );
}

export function StoryTime({ story, run }: { story: Story; run: CheckRun }) {
  const split = story.usage?.split ?? null;
  if (!split) {
    return (
      <Section term="timeSplit" id="time">
        <p className="rp-empty">No time split recorded for this story{story.usage ? " (recorded before the harness split time)" : ": its record has no usage"}.</p>
      </Section>
    );
  }
  const { parts, unaccounted } = splitParts(split);
  const check = checkView(split.check, run);
  const kinds = toolKinds(split);
  return (
    <Section term="timeSplit" id="time" aside={<span className="num">{duration(split.wall)} wall</span>}>
      <SegmentLegend />
      <div className="big-bar"><SplitBar split={split} usage={story.usage ?? null} scaleSeconds={split.wall} label={`story ${story.id}: ${duration(split.wall)}`} /></div>
      <div className="split-grid">
        <table className="rp-table parts" aria-label="Parts of the time">
          <thead><tr><th><Term id="splitParts" /></th><th className="n">Seconds</th><th className="n">Share</th></tr></thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.seg} data-seg={p.seg} className={p.seconds > 0 ? undefined : "zero"}>
                <td><span className="legend" data-tip={GLOSSARY[p.term].what}><i className={`seg-${p.seg}`} />{GLOSSARY[p.term].name}</span></td>
                <td className="n">{secs(p.seconds)}</td>
                <td className="n">{p.share !== null ? pct(p.share) : <Missing why="The story's wall time is 0, so there are no shares." />}</td>
              </tr>
            ))}
            {unaccounted !== 0 ? <tr data-seg="unaccounted" className="unaccounted"><td>Unaccounted</td><td className="n">{secs(unaccounted)}</td><td className="n">{pct(unaccounted / split.wall)}</td></tr> : null}
          </tbody>
        </table>
        <div className="split-side">
          <CheckVerdict check={split.check} run={run} v={check} />
          <div className="kinds">
            <div className="stat-label"><Term id="segTools">Tools by kind</Term></div>
            {kinds.length ? <ul>{kinds.map((k) => <li key={k.kind} data-kind={k.kind}><span>{k.kind}</span> <span className="num">{duration(k.seconds)}</span></li>)}</ul>
              : <span className="small">not recorded by kind</span>}
          </div>
        </div>
      </div>
      {split.check.status === "ok" ? null : <CheckExplain v={check} />}
    </Section>
  );
}

export function StoryCost({ usage }: { usage: Usage | null | undefined }) {
  if (!usage) return <Section term="cost" id="cost"><p className="rp-empty">No usage recorded for this story: {whyMissing(null, "story").replace(/^Not recorded: /, "")}</p></Section>;
  const u = usage;
  const or = (v: number | null, show: (n: number) => string, what: Parameters<typeof whyMissing>[1]) => (v === null ? <Missing why={whyMissing(u, what)} /> : show(v));
  return (
    <Section term="cost" id="cost">
      <div className="stats">
        <Stat term="outTokens">{or(u.outTokens, full, "story")}</Stat>
        <Stat term="inputRead" sub={u.readTokens && u.cacheRead != null ? `${pct(u.cacheRead / u.readTokens)} cached` : undefined}>{or(u.readTokens, short, "story")}</Stat>
        <Stat term="calls">{or(u.calls, full, "story")}</Stat>
        <Stat term="tokS">{or(u.tokS, speed, "story")}</Stat>
        <Stat term="decodeTokS">{or(u.decodeTokS, speed, "decode")}</Stat>
        <Stat term="prefillTokS">{or(u.prefillTokS, speed, "prefill")}</Stat>
        <Stat term="draftAcceptance">{or(u.draftAcceptance, pct, "draft")}</Stat>
        <Stat term="compactions">{or(u.compactions, String, "story")}</Stat>
        <Stat term="nudges">{or(u.nudges, String, "story")}</Stat>
      </div>
    </Section>
  );
}

const notCounted = (what: string) => <Missing why={`The harness couldn't count ${what} from this story's event log.`} />;

export function Conversation({ story }: { story: Story }) {
  const c = conversationView(story.conversation);
  if (!c) {
    return (
      <Section term="conversation" id="conversation">
        <p className="rp-empty" data-empty="conversation">Not recorded for this story: it was recorded before the harness kept a profile, or its client's log can't be read.</p>
      </Section>
    );
  }
  return (
    <Section term="conversation" id="conversation" aside={<span className="small">counted from the event log; no LLM</span>}>
      <div className="stats">
        <Stat term="modelCalls" sub={`${full(c.toolCalls)} tool calls`}>{full(c.calls)}</Stat>
        <Stat term="thinking" sub={`median ${full(c.thinkingMedian)} per call`}>{full(c.thinkingChars)} <span className="unit">chars</span></Stat>
        <Stat term="thinkingMedian" sub={c.afterRatio !== null ? `${c.afterRatio.toFixed(RATIO_DECIMALS)}× after the largest block` : undefined}>
          <span data-fact="before">{c.before !== null ? full(c.before) : notCounted("thinking before the largest block")}</span>
          <span className="arrow" aria-hidden="true"> → </span>
          <span data-fact="after">{c.after !== null ? full(c.after) : notCounted("thinking after the largest block")}</span>
        </Stat>
        <Stat term="largestThinking" sub={c.largest ? `call ${c.largest.call}, ${Math.round(c.largest.minutesIn)} min in` : undefined}>
          {c.largest ? <>{full(c.largest.chars)} <span className="unit">chars</span></> : notCounted("the largest thinking block")}
        </Stat>
        <Stat term="contextGrowth" sub={c.contextGrowth !== null ? `grew ${c.contextGrowth.toFixed(RATIO_DECIMALS)}×` : undefined}>
          {c.contextStart !== null ? short(c.contextStart) : notCounted("the context at the start")}
          <span className="arrow" aria-hidden="true"> → </span>
          {c.contextEnd !== null ? short(c.contextEnd) : notCounted("the context at the end")} <span className="unit">tokens</span>
        </Stat>
        <Stat term="contextJump" sub={c.largestJump ? `into call ${c.largestJump.call}` : undefined}>
          {c.largestJump ? <>+{full(c.largestJump.tokens)} <span className="unit">tokens</span></> : notCounted("context jumps")}
        </Stat>
        <Stat term="toolErrors">{full(c.toolErrors)}</Stat>
        <Stat term="longestTool" sub={c.longestTool ? (
          // One line, cut with an ellipsis: a long command or path would otherwise wrap into a tall, narrow column.
          <span className="tool-gist mono" tabIndex={0} data-tip={`${c.longestTool.name}: ${c.longestTool.gist}`}>{c.longestTool.name}: {c.longestTool.gist}</span>
        ) : undefined}>
          {c.longestTool ? secs(c.longestTool.seconds) : notCounted("tool call times")}
        </Stat>
      </div>
      <div className="conv-lists">
        <div data-list="tools">
          <div className="stat-label"><Term id="toolsByName" /></div>
          {c.tools.length ? <ul className="tool-list">{c.tools.map((t) => <li key={t.name} data-tool={t.name}><span className="mono">{t.name}</span> <span className="num">{full(t.calls)}</span></li>)}</ul> : <span className="small">no tool calls</span>}
        </div>
        <div data-list="signals">
          <div className="stat-label"><Term id="signals" /></div>
          {c.signals.length ? <ul className="signal-list">{c.signals.map((s) => <li key={s}>{s}</li>)}</ul> : <span className="small">none</span>}
        </div>
      </div>
    </Section>
  );
}
