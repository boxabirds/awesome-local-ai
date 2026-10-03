// One model call of a story run's conversation, in full: its thinking, its text, each tool it called with its
// arguments and result whole. The call before and after are a step away.
import type { Row, State, Story } from "../../shared/types.ts";
import { callHref, conversationHref } from "../../shared/routes.ts";
import { storyRunState, storyTitle } from "../../shared/runView.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { Breadcrumb, CombinationLink, RunLink, StoryRunLink } from "../components/EntityLinks.tsx";
import { StoryRunHeader } from "../components/run/StoryRunParts.tsx";
import { Missing, NotApplicable, Section, Stat, full } from "../components/run/bits.tsx";
import { useConversation, useInFull } from "../useConversation.ts";
import { NOT_AVAILABLE } from "./ConversationPage.tsx";
import "./run.css";
import "./conversation.css";

interface ToolInFull { idx: number; callIdx: number; name: string | null; kind: string | null; arg: string; start: number | null; end: number | null; error: number | null; resChars: number | null; passed: number | null; failed: number | null; args: unknown; result: string | null }
interface CallInFull { idx: number; think: number; text: string; nTools: number; outTok: number | null; inTok: number | null; cacheTok: number | null; stop: string | null; sub: number; thinking: string; sent: number | null; first: number | null; tools: ToolInFull[] }

const JSON_INDENT = 2;
const Quoted = ({ text, block }: { text: string; block?: boolean }) => (block ? <pre className="quoted" data-quoted="agent">{text}</pre> : <span className="quoted" data-quoted="agent">{text}</span>);

export function CallPage({ run, story, storyId, call, state }: { run: Row; story: Story | null; storyId: string; call: string; state: State }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const available = Boolean(id && story?.hasConversation);
  const idx = Number(call);
  const c = useInFull<CallInFull>(available ? id : null, `/calls/${idx}`);
  const conv = useConversation(available ? id : null);
  const calls = conv.summary ? conv.summary.counts.calls : null;
  const crumbs = [
    { label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> },
    { label: <RunLink pack={run.pack} stack={run.stack} runId={run.runId} /> },
    { label: <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={storyId} /> },
    { label: GLOSSARY.conversationPage.name, href: conversationHref(run.pack, run.stack, run.runId, storyId) },
    { label: `call ${idx + 1}` },
  ];
  const nav = (
    <nav className="call-nav" aria-label="Calls">
      {idx > 0 ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx - 1)} rel="prev">← call {idx}</a> : <span className="faint">← first call</span>}
      <a href={conversationHref(run.pack, run.stack, run.runId, storyId, "calls")}>all calls</a>
      {calls !== null && idx + 1 < calls ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx + 1)} rel="next">call {idx + 2} →</a> : <span className="faint">last call →</span>}
    </nav>
  );
  if (c === false || !story) {
    return (
      <div className="page call-page run-page" data-page="call" data-available="false">
        <Breadcrumb trail={crumbs} />
        <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
        <Section term="modelCall" id="call"><p className="rp-empty" data-empty="call"><Missing why={NOT_AVAILABLE} /> {NOT_AVAILABLE}</p>{nav}</Section>
      </div>
    );
  }
  const withheld = conv.summary ? conv.summary.fmt === "claude" : false;
  return (
    <div className="page call-page run-page" data-page="call" data-available="true" data-call={idx}>
      <Breadcrumb trail={crumbs} />
      <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
      <Section term="modelCall" id="call" aside={nav}>
        {c === null ? <p className="rp-empty small">Loading…</p> : <>
          <div className="stats">
            <Stat term="thinking">{withheld ? <NotApplicable why="This client withholds its thinking." /> : <>{full(c.think)} <span className="unit">chars</span></>}</Stat>
            <Stat term="outTokens">{c.outTok !== null ? full(c.outTok) : <Missing why="The client didn't report this call's tokens." />}</Stat>
            <Stat term="inputRead">{c.inTok !== null ? full(c.inTok + (c.cacheTok ?? 0)) : <Missing why="The client didn't report this call's tokens." />}</Stat>
            <Stat term="calls">{full(c.nTools)}</Stat>
          </div>
          {!withheld && c.thinking ? <div className="call-block" data-block="thinking"><h3>Thinking</h3><Quoted text={c.thinking} block /></div> : null}
          <div className="call-block" data-block="text"><h3>Text</h3>{c.text ? <Quoted text={c.text} block /> : <span className="small">none</span>}</div>
          {c.tools.map((t) => (
            <div className="call-block tool" data-block="tool" data-tool={t.idx} key={t.idx}>
              <h3><span className="mono">{t.name ?? ""}</span> <span className="small">{t.kind ?? ""}{t.error === 1 ? " · failed" : t.end === null ? " · no end yet" : ""}</span></h3>
              <h4>Arguments</h4><Quoted text={JSON.stringify(t.args, null, JSON_INDENT)} block />
              <h4>Result</h4>{t.result !== null ? <Quoted text={t.result} block /> : <Missing why="This tool call has no result yet." />}
            </div>
          ))}
        </>}
      </Section>
    </div>
  );
}
