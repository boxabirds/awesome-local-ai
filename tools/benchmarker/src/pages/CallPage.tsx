// One model call of a story run's conversation, in full. Four concertina items in the call's own order, closed at first, each
// heading carrying its figure in tokens: input (what was new to the call), thinking, tool calls (each with its result), output
// (what the model produced: its text and the tool calls it issued). Nothing scrolls inside the page; the open item's heading
// pins. Only the call: the breadcrumb names the story, the second row is the call and its neighbours.
import { useState } from "react";
import type { Row, State, Story } from "../../shared/types.ts";
import { callHref, conversationHref, withParams, type Route } from "../../shared/routes.ts";
import { storyTitle } from "../../shared/runView.ts";
import { outputSplit } from "../../shared/callView.ts";
import { cutText, turns, type ConversationEvent, type CutText, type Turn } from "../../shared/conversation.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { Missing, NotApplicable, full } from "../components/run/bits.tsx";
import { Concertina } from "../components/conversation/Concertina.tsx";
import { useConversation, useInFull } from "../useConversation.ts";
import { NOT_AVAILABLE } from "./ConversationPage.tsx";
import "./run.css";
import "./conversation.css";

interface ToolInFull { idx: number; callIdx: number; name: string | null; kind: string | null; arg: string; start: number | null; end: number | null; error: number | null; resChars: number | null; passed: number | null; failed: number | null; args: unknown; result: string | null }
interface CallInFull { idx: number; think: number; text: string; nTools: number; outTok: number | null; inTok: number | null; cacheTok: number | null; stop: string | null; sub: number; thinking: string; sent: number | null; first: number | null; tools: ToolInFull[] }

const JSON_INDENT = 2;
const APPROX = "≈";
const SHARED_OUT = "Tokens are recorded for the whole output of a call, not for its parts. This is the call's output tokens shared out by the characters of its thinking, its text and its tool arguments, so the parts add up to the output.";
const tokens = (n: number) => `${full(n)} tokens`;
const Quoted = ({ text }: { text: string }) => <pre className="cc-text" data-quoted="agent">{text}</pre>;
const NEIGHBOUR_CHARS = 40;
/** A neighbouring call's first line of text, cut for a link's label, whole on hover. */
function Neighbour({ c }: { c: CallInFull | null | false }) {
  const line = c ? (c.text.split("\n").find((l) => l.trim()) ?? "").trim() : "";
  if (!line) return null;
  const short = line.length > NEIGHBOUR_CHARS ? `${line.slice(0, NEIGHBOUR_CHARS)}…` : line;
  return <> · <span data-quoted="agent"><span className="neighbour-text" data-tip={line}>{short}</span></span></>;
}
const argsText = (t: ToolInFull) => JSON.stringify(t.args, null, JSON_INDENT);
/** A tool's heading: its name, and its kind only where that says more than the name does ("bash e2e", not "write write"). */
const ToolName = ({ t }: { t: ToolInFull }) => <><span className="mono">{t.name ?? ""}</span>{t.kind && t.kind !== t.name ? <> <span className="small">{t.kind}</span></> : null}</>;

type Open = { thinking: boolean; output: boolean; input: boolean; tools: boolean };
const CONTEXT_NOTE = "The request itself is not recorded; this is the context as the transcript gives it: every turn since the start or the last compaction, up to the call before.";
const cut = (v: unknown) => cutText(v as CutText | null);

/** The context a call was sent with, as the transcript gives it: the turns after the last compaction before it. */
function contextBefore(all: Turn[], callIdx: number): Turn[] {
  const at = all.findIndex((t) => t.callIdx === callIdx && t.kind === "call");
  if (at < 0) return [];
  const before = all.slice(0, at).filter((t) => t.kind === "msg" || t.kind === "call" || t.kind === "tool" || t.kind === "compaction");
  const lastCompaction = before.map((t) => t.kind).lastIndexOf("compaction");
  return lastCompaction < 0 ? before : before.slice(lastCompaction);
}

/** One turn of the context: a message's text; a call's text and each tool it called with its arguments and result; a compaction. */
function ContextTurn({ t, i }: { t: Turn; i: number }) {
  const e: ConversationEvent = t.event;
  const tools = t.tools.map((x) => (
    <div key={x.idx} data-context-tool={x.idx} className="ctx-tool">
      <h5><span className="mono">{String(x.start.name ?? "")}</span> <span className="small">{String(x.start.toolKind ?? "")}</span></h5>
      <Quoted text={String(x.start.arg ?? "")} />
      {x.end ? <Quoted text={cut(x.end.result)} /> : <Missing why="This tool call has no result yet." />}
    </div>
  ));
  return (
    <div className="ctx-turn" data-context-turn={i} data-kind={t.kind}>
      {t.kind === "msg" ? <><h5>message</h5><Quoted text={cut(e.textBody)} /></>
        : t.kind === "call" ? <><h5>call {(t.callIdx ?? 0) + 1}</h5>{cut(e.textBody) ? <Quoted text={cut(e.textBody)} /> : null}{tools}</>
        : t.kind === "compaction" ? <h5>compaction: the context before it was summarised</h5>
        : tools}
    </div>
  );
}
const CLOSED: Open = { thinking: false, output: false, input: false, tools: false };

export function CallPage({ route, run, story, storyId, call, state }: { route: Route; run: Row; story: Story | null; storyId: string; call: string; state: State }) {
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const available = Boolean(id && story?.hasConversation);
  const idx = Number(call);
  const c = useInFull<CallInFull>(available ? id : null, `/calls/${idx}`);
  const conv = useConversation(available ? id : null);
  const [open, setOpen] = useState<{ at: number; items: Open }>({ at: idx, items: CLOSED });
  const [contextOpen, setContextOpen] = useState<number | null>(null);      // the call whose context is expanded
  const items = open.at === idx ? open.items : CLOSED;       // another call starts closed
  const toggle = (k: keyof Open) => setOpen({ at: idx, items: { ...items, [k]: !items[k] } });
  // The calls either side: what the one before returned is this call's new input, and each names itself in the
  // page's second row by its first line of text.
  const before = useInFull<CallInFull>(available && idx > 0 ? id : null, `/calls/${idx - 1}`);
  const after = useInFull<CallInFull>(available ? id : null, `/calls/${idx + 1}`);
  const calls = conv.summary ? conv.summary.counts.calls : null;
  const crumbs = <Breadcrumb route={route} names={{ combination: run.label, story: title }} />;
  const nav = (
    <nav className="call-nav" aria-label="Calls">
      <span className="call-of" data-fact="call-of">Call {idx + 1}{calls !== null ? ` of ${full(calls)}` : ""}</span>
      <a className="back" href={withParams(conversationHref(run.pack, run.stack, run.runId, storyId), { call: String(idx) })}>← Back to the conversation</a>
      {idx > 0 ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx - 1)} rel="prev">← call {idx}<Neighbour c={before} /></a> : <span className="faint">← first call</span>}
      {calls !== null && idx + 1 < calls ? <a href={callHref(run.pack, run.stack, run.runId, storyId, idx + 1)} rel="next">call {idx + 2}<Neighbour c={after} /> →</a> : <span className="faint">last call →</span>}
    </nav>
  );
  if (c === false || !story) {
    return (
      <div className="page call-page run-page" data-page="call" data-available="false">
        {crumbs}
        {nav}
        <p className="rp-empty" data-empty="call"><Missing why={NOT_AVAILABLE} /> {NOT_AVAILABLE}</p>
      </div>
    );
  }
  const withheld = conv.summary ? conv.summary.fmt === "claude" : false;
  const opening = idx === 0 ? cutText((conv.events.find((e) => e.kind === "msg")?.textBody ?? null) as CutText | null) : "";
  const context = idx > 0 ? contextBefore(turns(conv.events), idx) : [];
  const showContext = contextOpen === idx;
  const split = c ? outputSplit(c.outTok, { thinking: withheld ? 0 : c.think, text: c.text.length, tools: c.tools.reduce((n, t) => n + argsText(t).length, 0) }) : null;
  const missingTokens = <Missing why="The client didn't report this call's tokens." />;
  return (
    <div className="page call-page run-page" data-page="call" data-available="true" data-call={idx}>
      {crumbs}
      {nav}
      {c === null ? <p className="rp-empty small">Loading…</p> : <>
        <Concertina block="input" label="Input" open={items.input} onToggle={() => toggle("input")}
          figure={c.inTok !== null ? tokens(c.inTok + (c.cacheTok ?? 0)) : missingTokens}>
          <div data-part="new">
            {idx === 0 ? (opening ? <Quoted text={opening} /> : <Missing why="The conversation has no opening message." />)
              : before === null ? <p className="small">Loading…</p>
              : before === false || before.tools.length === 0 ? <p className="small">The call before returned no tool results.</p>
              : before.tools.map((t) => (
                <div key={t.idx} data-prev-tool={t.idx}>{t.result !== null ? <Quoted text={t.result} /> : <Missing why="This tool call has no result yet." />}</div>
              ))}
          </div>
          {context.length ? <div data-part="cache">
            <button type="button" className="cc-row cc-expand" aria-expanded={showContext} aria-controls="cc-context" onClick={() => setContextOpen(showContext ? null : idx)}>
              <span>{full(c.cacheTok ?? 0)} tokens read from the cache</span><span className="cc-expand-word">{showContext ? "Collapse ▾" : "Expand ▸"}</span>
            </button>
            {showContext ? <div id="cc-context" data-part="context" className="cc-context">
              <p className="small">{CONTEXT_NOTE}</p>
              {context.map((t, i) => <ContextTurn key={i} t={t} i={i} />)}
            </div> : null}
          </div> : null}
        </Concertina>
        <Concertina block="thinking" label="Thinking" open={items.thinking} onToggle={() => toggle("thinking")} disabled={withheld || !c.thinking}
          tip={withheld ? undefined : SHARED_OUT}
          figure={withheld ? <NotApplicable why="This client withholds its thinking." /> : split ? `${APPROX} ${tokens(split.thinking)}` : missingTokens}>
          <Quoted text={c.thinking} />
        </Concertina>
        <Concertina block="tools" label="Tool calls" open={items.tools} onToggle={() => toggle("tools")}
          tip={split ? SHARED_OUT : undefined}
          figure={<>{full(c.nTools)} {c.nTools === 1 ? "call" : "calls"}{split ? `, ${APPROX} ${tokens(split.tools)}` : ""}</>}>
          {c.tools.length === 0 ? <span className="small">none</span> : c.tools.map((t) => (
            <div className="call-tool" data-block="tool" data-tool={t.idx} key={t.idx}>
              <h3><ToolName t={t} /><span className="small">{t.error === 1 ? " · failed" : t.end === null ? " · no end yet" : ""}</span></h3>
              <h4>Arguments</h4><Quoted text={argsText(t)} />
              <h4>Result</h4>{t.result !== null ? <Quoted text={t.result} /> : <Missing why="This tool call has no result yet." />}
            </div>
          ))}
        </Concertina>
        <Concertina block="output" label="Output" open={items.output} onToggle={() => toggle("output")} tip={split ? SHARED_OUT : undefined}
          figure={c.outTok !== null ? tokens(c.outTok) : missingTokens}>
          {split ? <p className="small cc-split">thinking {APPROX} {full(split.thinking)} · text {APPROX} {full(split.text)} · tool calls {APPROX} {tokens(split.tools)}</p> : null}
          <div data-part="text"><h4>Text</h4>{c.text ? <Quoted text={c.text} /> : <span className="small">none: the model only called tools</span>}</div>
          {c.tools.length ? <div data-part="issued"><h4>Tool calls issued</h4>{c.tools.map((t) => (
            <div key={t.idx} data-issued={t.idx}><h5><ToolName t={t} /></h5><Quoted text={argsText(t)} /></div>
          ))}</div> : null}
        </Concertina>
      </>}
    </div>
  );
}
