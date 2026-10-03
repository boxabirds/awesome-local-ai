// One model call of a story run's conversation, in full: its thinking, its text, each tool it called with its
// arguments and result whole. The call before and after are a step away.
import type { Row, State, Story } from "../../shared/types.ts";
import { callHref, conversationHref, withParams, type Route } from "../../shared/routes.ts";
import { storyRunState, storyTitle } from "../../shared/runView.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { StoryRunLine } from "../components/run/StoryRunParts.tsx";
import { Missing, NotApplicable, Section, Stat, full } from "../components/run/bits.tsx";
import { Clamped } from "../components/conversation/text.tsx";
import { useConversation, useInFull } from "../useConversation.ts";
import { NOT_AVAILABLE } from "./ConversationPage.tsx";
import "./run.css";
import "./conversation.css";

interface ToolInFull { idx: number; callIdx: number; name: string | null; kind: string | null; arg: string; start: number | null; end: number | null; error: number | null; resChars: number | null; passed: number | null; failed: number | null; args: unknown; result: string | null }
interface CallInFull { idx: number; think: number; text: string; nTools: number; outTok: number | null; inTok: number | null; cacheTok: number | null; stop: string | null; sub: number; thinking: string; sent: number | null; first: number | null; tools: ToolInFull[] }

const JSON_INDENT = 2;
const Quoted = ({ text }: { text: string }) => <Clamped text={text} block />;

export function CallPage({ route, run, story, storyId, call, state }: { route: Route; run: Row; story: Story | null; storyId: string; call: string; state: State }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const available = Boolean(id && story?.hasConversation);
  const idx = Number(call);
  const c = useInFull<CallInFull>(available ? id : null, `/calls/${idx}`);
  const conv = useConversation(available ? id : null);
  const calls = conv.summary ? conv.summary.counts.calls : null;
  const crumbs = <Breadcrumb route={route} names={{ combination: run.label }} />;
  const nav = (
    <nav className="call-nav" aria-label="Calls">
      <a className="back" href={withParams(conversationHref(run.pack, run.stack, run.runId, storyId), { call: String(idx) })}>← Back to the conversation</a>
      <span className="call-of" data-fact="call-of">Call {idx + 1}{calls !== null ? ` of ${full(calls)}` : ""}</span>
      {idx > 0 ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx - 1)} rel="prev">← call {idx}</a> : <span className="faint">← first call</span>}
      {calls !== null && idx + 1 < calls ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx + 1)} rel="next">call {idx + 2} →</a> : <span className="faint">last call →</span>}
    </nav>
  );
  if (c === false || !story) {
    return (
      <div className="page call-page run-page" data-page="call" data-available="false">
        {crumbs}
        <StoryRunLine run={run} st={st} storyId={storyId} title={title} />
        <Section term="modelCall" id="call"><p className="rp-empty" data-empty="call"><Missing why={NOT_AVAILABLE} /> {NOT_AVAILABLE}</p>{nav}</Section>
      </div>
    );
  }
  const withheld = conv.summary ? conv.summary.fmt === "claude" : false;
  return (
    <div className="page call-page run-page" data-page="call" data-available="true" data-call={idx}>
      {crumbs}
      <StoryRunLine run={run} st={st} storyId={storyId} title={title} />
      <Section term="modelCall" id="call" aside={nav}>
        {c === null ? <p className="rp-empty small">Loading…</p> : <>
          <div className="stats">
            <Stat term="thinking">{withheld ? <NotApplicable why="This client withholds its thinking." /> : <>{full(c.think)} <span className="unit">chars</span></>}</Stat>
            <Stat term="outTokens">{c.outTok !== null ? full(c.outTok) : <Missing why="The client didn't report this call's tokens." />}</Stat>
            <Stat term="inputRead">{c.inTok !== null ? full(c.inTok + (c.cacheTok ?? 0)) : <Missing why="The client didn't report this call's tokens." />}</Stat>
            <Stat term="calls">{full(c.nTools)}</Stat>
          </div>
          {!withheld && c.thinking ? <div className="call-block" data-block="thinking"><h3>Thinking</h3><Quoted text={c.thinking} /></div> : null}
          <div className="call-block" data-block="text"><h3>Text</h3>{c.text ? <Quoted text={c.text} /> : <span className="small">none</span>}</div>
          {c.tools.map((t) => (
            <div className="call-block tool" data-block="tool" data-tool={t.idx} key={t.idx}>
              <h3><span className="mono">{t.name ?? ""}</span> <span className="small">{t.kind ?? ""}{t.error === 1 ? " · failed" : t.end === null ? " · no end yet" : ""}</span></h3>
              <h4>Arguments</h4><Quoted text={JSON.stringify(t.args, null, JSON_INDENT)} />
              <h4>Result</h4>{t.result !== null ? <Quoted text={t.result} /> : <Missing why="This tool call has no result yet." />}
            </div>
          ))}
        </>}
      </Section>
    </div>
  );
}
