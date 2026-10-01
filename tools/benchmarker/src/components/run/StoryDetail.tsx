// One story run in detail: where its time went, part by part; what it cost; and what the conversation looked like.
import type { Story, Usage } from "../../../shared/types.ts";
import { conversationView, splitParts, toolKinds, whyMissing } from "../../../shared/runView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { short } from "../UsageCells.tsx";
import { duration } from "../../format.ts";
import { Missing, NotApplicable, Section, Stat, Term, full } from "./bits.tsx";
import { SegmentLegend, SplitBar } from "./SplitBar.tsx";
import { NO_SPLIT } from "./RunTime.tsx";
import { EngineSpeed, pct, speed } from "./RunCost.tsx";

const RATIO_DECIMALS = 1;

const secs = (s: number) => `${full(s)} s`;

export function StoryTime({ story }: { story: Story }) {
  const split = story.usage?.split ?? null;
  if (!split) {
    return (
      <Section term="timeSplit" id="time">
        <p className="rp-empty" data-empty="split"><Missing why={NO_SPLIT} /> {NO_SPLIT}</p>
      </Section>
    );
  }
  const { parts, unaccounted } = splitParts(split);
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
          <div className="kinds">
            <div className="stat-label"><Term id="segTools">Tools by kind</Term></div>
            {kinds.length ? <ul>{kinds.map((k) => <li key={k.kind} data-kind={k.kind}><span>{k.kind}</span> <span className="num">{duration(k.seconds)}</span></li>)}</ul>
              : <span className="small">not recorded by kind</span>}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function StoryCost({ usage, cloud = false }: { usage: Usage | null | undefined; cloud?: boolean }) {
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
        <Stat term="draftAcceptance">{cloud ? <NotApplicable /> : or(u.draftAcceptance, pct, "draft")}</Stat>
        <Stat term="compactions">{or(u.compactions, String, "story")}</Stat>
        <Stat term="nudges">{or(u.nudges, String, "story")}</Stat>
      </div>
      <EngineSpeed decode={u.decodeTokS} prefill={u.prefillTokS} whyDecode={whyMissing(u, "decode")} whyPrefill={whyMissing(u, "prefill")} cloud={cloud} />
    </Section>
  );
}

const notCounted = (what: string) => <Missing why={`Not counted: ${what}.`} />;

/** Per call: how much more after the largest block; for a cloud model, that the figures are estimates. */
function perCallSub(afterRatio: number | null, estimated: boolean): string | undefined {
  const parts = [estimated ? "estimated tokens" : null, afterRatio !== null ? `${afterRatio.toFixed(RATIO_DECIMALS)}× after the largest block` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function Conversation({ story }: { story: Story }) {
  const c = conversationView(story.conversation);
  // An estimate is marked "~" so it can't be read as an exact count.
  const est = (n: number) => (c?.perCallEstimated ? `~${full(n)}` : full(n));
  if (!c) {
    return (
      <Section term="conversation" id="conversation">
        <p className="rp-empty" data-empty="conversation">No conversation profile for this story.</p>
      </Section>
    );
  }
  return (
    <Section term="conversation" id="conversation" aside={<span className="small">counted from the event log; no LLM</span>}>
      <div className="stats">
        <Stat term="modelCalls" sub={`${full(c.toolCalls)} tool calls`}>{full(c.calls)}</Stat>
        <Stat term="thinking" sub={c.thinkingMedian !== null ? `median ${full(c.thinkingMedian)} per call` : undefined}>
          {c.thinkingTotal !== null ? <>{full(c.thinkingTotal)} <span className="unit">{c.thinkingUnit}</span></> : notCounted("thinking")}
        </Stat>
        <Stat term="thinkingMedian" sub={perCallSub(c.afterRatio, c.perCallEstimated)}>
          <span data-fact="before">{c.before !== null ? est(c.before) : notCounted("thinking before the largest block")}</span>
          <span className="arrow" aria-hidden="true"> → </span>
          <span data-fact="after">{c.after !== null ? est(c.after) : notCounted("thinking after the largest block")}</span>
        </Stat>
        <Stat term="largestThinking" sub={c.largest ? `call ${c.largest.call}, ${Math.round(c.largest.minutesIn)} min in${c.perCallEstimated ? " · estimated" : ""}` : undefined}>
          {c.largest ? <>{est(c.largest.size)} <span className="unit">{c.thinkingUnit}</span></> : notCounted("the largest thinking block")}
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
