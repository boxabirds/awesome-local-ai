// A story run's conversation, happening by happening (plan section 4.4, as the time-range cursor API gives it).
// The page backfills the span and then follows along after its latest cursor; the story's status plays no part.
// Verbatim agent text is marked data-quoted="agent": it is a result, never the app's own words.
import { useEffect, type ReactNode } from "react";
import type { Row, State, Story } from "../../shared/types.ts";
import { cutText, timeline, type ConversationAnchor, type ConversationEvent, type CutText } from "../../shared/conversation.ts";
import { callHref, conversationHref } from "../../shared/routes.ts";
import { storyRunState, storyTitle } from "../../shared/runView.ts";
import { GLOSSARY, type TermId } from "../../shared/glossary.ts";
import { Breadcrumb, CombinationLink, RunLink, StoryRunLink } from "../components/EntityLinks.tsx";
import { StoryRunHeader } from "../components/run/StoryRunParts.tsx";
import { Missing, NotApplicable, Section, Term, full, utc } from "../components/run/bits.tsx";
import { duration } from "../format.ts";
import { useConversation } from "../useConversation.ts";
import "./run.css";
import "./conversation.css";

const TIMELINE_BINS = 60;
const MS_PER_S = 1000;
const PERCENT = 100;
const MIN_TICK_PERCENT = 2;
export const NOT_AVAILABLE = "Not available.";

const SECTIONS: { id: ConversationAnchor; term: TermId; kinds: string[] }[] = [
  { id: "calls", term: "modelCall", kinds: ["call"] },
  { id: "tools", term: "toolCall", kinds: ["tool_start"] },
  { id: "compactions", term: "compactionEvent", kinds: ["compaction_start"] },
  { id: "sessions", term: "betweenSessionsEvent", kinds: ["between_sessions"] },
  { id: "messages", term: "harnessMessage", kinds: ["msg"] },
  { id: "requests", term: "engineRequest", kinds: ["request"] },
  { id: "conditions", term: "conditionReading", kinds: ["condition"] },
];

const secs = (ms: number, from: number) => `${((ms - from) / MS_PER_S).toFixed(1)} s`;
const n = (v: unknown) => (typeof v === "number" ? full(v) : null);
const num = (v: unknown, why: string) => (typeof v === "number" ? full(v) : <Missing why={why} />);
const isNum = (v: unknown): v is number => typeof v === "number";

/** Verbatim text from the agent's conversation: a result, marked as such. */
const Quoted = ({ text, className }: { text: string; className?: string }) => <span className={`quoted ${className ?? ""}`} data-quoted="agent">{text}</span>;

export function ConversationPage({ run, story, storyId, state, params }: { run: Row; story: Story | null; storyId: string; state: State; params?: Record<string, string> }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const conv = useConversation(id && story?.hasConversation ? id : null);
  const at = params?.at;
  useEffect(() => {
    if (at && conv.backfilled) document.getElementById(`sec-${at}`)?.scrollIntoView({ block: "start" });
  }, [at, conv.backfilled]);
  const crumbs = [
    { label: <CombinationLink pack={run.pack} stack={run.stack} label={run.label} /> },
    { label: <RunLink pack={run.pack} stack={run.stack} runId={run.runId} /> },
    { label: <StoryRunLink pack={run.pack} stack={run.stack} runId={run.runId} story={storyId} /> },
    { label: GLOSSARY.conversationPage.name },
  ];
  if (conv.summary === false || !story) {
    return (
      <div className="page conversation-page run-page" data-page="conversation" data-available="false">
        <Breadcrumb trail={crumbs} />
        <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
        <Section term="conversationPage" id="conversation">
          <p className="rp-empty" data-empty="conversation"><Missing why={NOT_AVAILABLE} /> {NOT_AVAILABLE}</p>
        </Section>
      </div>
    );
  }
  const s = conv.summary;
  const from = s?.range.fromMs ?? 0;
  const link = (call: number | string) => callHref(run.pack, run.stack, run.runId, storyId, call);
  const toMs = s ? Math.max(s.range.toMs, ...conv.events.map((e) => e.tMs + 1)) : 0;
  const bins = s ? timeline(conv.events, { fromMs: from, toMs }, TIMELINE_BINS) : [];
  const maxCalls = Math.max(1, ...bins.map((b) => b.calls));
  const of = (kinds: string[]) => conv.events.filter((e) => kinds.includes(e.kind));
  return (
    <div className="page conversation-page run-page" data-page="conversation" data-available="true" data-backfilled={conv.backfilled ? "true" : "false"} data-polls={conv.polls}>
      <Breadcrumb trail={crumbs} />
      <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
      <Section term="conversationPage" id="conversation" aside={s ? <span className="small" data-fact="range">{utc(from / MS_PER_S)} · {duration((toMs - from) / MS_PER_S)} · <span data-fact="events">{full(conv.events.length)}</span> events{s.complete ? "" : " so far"}</span> : null}>
        <nav className="conv-sections" aria-label="Sections of the conversation">
          {SECTIONS.map((sec) => <a key={sec.id} href={conversationHref(run.pack, run.stack, run.runId, storyId, sec.id)} data-anchor={sec.id} aria-current={at === sec.id ? "true" : undefined}>{GLOSSARY[sec.term].name} <span className="num">{of(sec.kinds).length}</span></a>)}
        </nav>
        <figure className="conv-timeline" aria-label={GLOSSARY.callTimeline.name} data-tip={GLOSSARY.callTimeline.what}>
          {bins.map((b, i) => (
            b.firstCallIdx !== null
              ? <a key={i} className={`tick${b.compaction ? " compaction" : ""}`} href={link(b.firstCallIdx)} style={{ height: `${Math.max(MIN_TICK_PERCENT, (b.calls / maxCalls) * PERCENT)}%` }} data-tip={`${secs(b.fromMs, from)}: ${b.calls} call${b.calls === 1 ? "" : "s"}${b.compaction ? ", compacted" : ""}`} aria-label={`${b.calls} calls at ${secs(b.fromMs, from)}`} />
              : <span key={i} className={`tick empty${b.compaction ? " compaction" : ""}`} style={{ height: `${MIN_TICK_PERCENT}%` }} data-tip={`${secs(b.fromMs, from)}: no call${b.compaction ? ", compacted" : ""}`} />
          ))}
        </figure>
      </Section>
      <Calls events={of(["call"])} from={from} fmt={s?.fmt ?? null} link={link} />
      <Tools events={of(["tool_start", "tool_end"])} from={from} link={link} />
      <Compactions events={of(["compaction_start", "compaction_end"])} from={from} />
      <Sessions events={of(["between_sessions"])} from={from} />
      <Messages events={of(["msg"])} from={from} />
      <Requests events={of(["request"])} from={from} link={link} />
      <Conditions events={of(["condition"])} from={from} />
    </div>
  );
}

function Sec({ id, term, count, children }: { id: ConversationAnchor; term: TermId; count: number; children: ReactNode }) {
  return <section className="rp-section conv-section" id={`sec-${id}`} data-section={id} aria-labelledby={`h-${id}`}>
    <div className="rp-head"><h2 id={`h-${id}`}><Term id={term} /></h2><div className="rp-aside"><span className="num">{full(count)}</span></div></div>
    <div className="rp-body">{count ? children : <p className="rp-empty small">None.</p>}</div>
  </section>;
}

function Calls({ events, from, fmt, link }: { events: ConversationEvent[]; from: number; fmt: string | null; link: (i: number | string) => string }) {
  const withheld = fmt === "claude";
  return (
    <Sec id="calls" term="modelCall" count={events.length}>
      <div className="table-scroll">
        <table className="rp-table conv-table calls" aria-label={GLOSSARY.modelCall.name}>
          <thead><tr><th>Call</th><th className="n">At</th><th className="n">Thinking</th><th className="n">Text</th><th className="n">Tools</th><th className="n">Read</th><th className="n">Wrote</th><th>Stop</th><th>Said</th></tr></thead>
          <tbody>
            {events.map((e) => {
              const think = e.thinking as CutText | null | undefined;
              const idx = isNum(e.refIdx) ? e.refIdx : 0;
              return (
                <tr key={e.ord} data-call={idx} data-sub={e.sub === 1 ? "true" : undefined}>
                  <td><a className="entity call-link" href={link(idx)}>call {idx + 1}</a>{e.sub === 1 ? <span className="small"> subagent</span> : null}</td>
                  <td className="n">{secs(e.tMs, from)}</td>
                  <td className="n">{withheld ? <NotApplicable why="This client withholds its thinking: the count isn't known." /> : num(e.think, "Not counted.")}</td>
                  <td className="n">{num(e.text, "Not counted.")}</td>
                  <td className="n">{num(e.nTools, "Not counted.")}</td>
                  <td className="n">{isNum(e.inTok) ? full(e.inTok + (isNum(e.cacheTok) ? e.cacheTok : 0)) : <Missing why="The client didn't report this call's tokens." />}</td>
                  <td className="n">{num(e.outTok, "The client didn't report this call's tokens.")}</td>
                  <td>{typeof e.stop === "string" ? e.stop : <Missing why="The client didn't report why the call stopped." />}</td>
                  <td className="said"><Quoted text={cutText(e.textBody as CutText) || (think && !withheld ? cutText(think) : "")} className="gist" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function Tools({ events, from, link }: { events: ConversationEvent[]; from: number; link: (i: number | string) => string }) {
  const starts = events.filter((e) => e.kind === "tool_start");
  const ends = new Map(events.filter((e) => e.kind === "tool_end").map((e) => [e.refIdx, e]));
  return (
    <Sec id="tools" term="toolCall" count={starts.length}>
      <div className="table-scroll">
        <table className="rp-table conv-table tools" aria-label={GLOSSARY.toolCall.name}>
          <thead><tr><th>Tool</th><th>Kind</th><th className="n">At</th><th className="n">Seconds</th><th>Outcome</th><th>Argument</th><th>Call</th></tr></thead>
          <tbody>
            {starts.map((e) => {
              const end = ends.get(e.refIdx);
              const counts = end && isNum(end.passed) ? `${end.passed} passed${isNum(end.failed) ? `, ${end.failed} failed` : ""}` : "";
              const callIdx = isNum(e.callIdx) ? e.callIdx : 0;
              return (
                <tr key={e.ord} data-tool={isNum(e.refIdx) ? e.refIdx : undefined} data-error={end?.error === 1 ? "true" : undefined} data-open={end ? undefined : "true"}>
                  <td><span className="mono">{String(e.name ?? "")}</span>{e.sub === 1 ? <span className="small"> subagent</span> : null}</td>
                  <td>{String(e.toolKind ?? "")}</td>
                  <td className="n">{secs(e.tMs, from)}</td>
                  <td className="n">{end ? n(end.seconds) : <Missing why="This tool call has no end yet." />}</td>
                  <td>{end ? (end.error === 1 ? "failed" : "ok") : <Missing why="This tool call has no end yet." />}{counts ? <span className="small"> · {counts}</span> : null}</td>
                  <td className="said"><Quoted text={String(e.arg ?? "")} className="mono gist" /></td>
                  <td><a className="entity call-link" href={link(callIdx)}>call {callIdx + 1}</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function Compactions({ events, from }: { events: ConversationEvent[]; from: number }) {
  const starts = events.filter((e) => e.kind === "compaction_start");
  const ends = new Map(events.filter((e) => e.kind === "compaction_end").map((e) => [e.refIdx, e]));
  return (
    <Sec id="compactions" term="compactionEvent" count={starts.length}>
      <ul className="conv-list">
        {starts.map((e) => { const end = ends.get(e.refIdx); return <li key={e.ord} data-compaction={isNum(e.refIdx) ? e.refIdx : undefined}>at {secs(e.tMs, from)}: {String(e.reason ?? "")}{end ? <> · {n(end.seconds)} s · summary {n(end.summaryChars)} chars</> : <> · <Missing why="This compaction has no end yet." /></>}</li>; })}
      </ul>
    </Sec>
  );
}

function Sessions({ events, from }: { events: ConversationEvent[]; from: number }) {
  return (
    <Sec id="sessions" term="betweenSessionsEvent" count={events.length}>
      <ul className="conv-list">{events.map((e) => <li key={e.ord}>from {secs(e.tMs, from)}: waited {n(e.seconds)} s</li>)}</ul>
    </Sec>
  );
}

function Messages({ events, from }: { events: ConversationEvent[]; from: number }) {
  return (
    <Sec id="messages" term="harnessMessage" count={events.length}>
      <ul className="conv-list messages">{events.map((e) => <li key={e.ord} data-msg={isNum(e.refIdx) ? e.refIdx : undefined}><span className="num">{secs(e.tMs, from)}</span> <Quoted text={cutText(e.textBody as CutText)} /></li>)}</ul>
    </Sec>
  );
}

function Requests({ events, from, link }: { events: ConversationEvent[]; from: number; link: (i: number | string) => string }) {
  return (
    <Sec id="requests" term="engineRequest" count={events.length}>
      <div className="table-scroll">
        <table className="rp-table conv-table requests" aria-label={GLOSSARY.engineRequest.name}>
          <thead><tr><th className="n">At</th><th>Call</th><th className="n">Prompt tok</th><th className="n">Generated</th><th className="n">Prefill s</th><th className="n">Decode s</th><th className="n">Prefill tok/s</th><th className="n">Decode tok/s</th><th className="n">Drafts accepted</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.ord} data-request={isNum(e.refIdx) ? e.refIdx : undefined}>
                <td className="n">{secs(e.tMs, from)}</td>
                <td>{isNum(e.callIdx) ? <a className="entity call-link" href={link(e.callIdx)}>call {e.callIdx + 1}</a> : <Missing why="No call of this story matched this request." />}</td>
                <td className="n">{num(e.promptTok, "Not reported by the server.")}</td>
                <td className="n">{num(e.generatedTok, "Not reported by the server.")}</td>
                <td className="n">{isNum(e.prefillS) ? e.prefillS.toFixed(1) : <Missing why="Not reported by the server." />}</td>
                <td className="n">{isNum(e.decodeS) ? e.decodeS.toFixed(1) : <Missing why="Not reported by the server." />}</td>
                <td className="n">{num(e.prefillTokS, "Not reported by the server.")}</td>
                <td className="n">{num(e.decodeTokS, "Not reported by the server.")}</td>
                <td className="n">{isNum(e.draftAccepted) && isNum(e.draftProposed) ? `${e.draftAccepted}/${e.draftProposed}` : <NotApplicable why="Nothing was drafted for this request." />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function Conditions({ events, from }: { events: ConversationEvent[]; from: number }) {
  return (
    <Sec id="conditions" term="conditionReading" count={events.length}>
      <div className="table-scroll">
        <table className="rp-table conv-table conditions" aria-label={GLOSSARY.conditionReading.name}>
          <thead><tr><th className="n">At</th><th>Thermal</th><th className="n">Swap GB</th><th className="n">Free %</th><th className="n">Footprint GB</th><th className="n">GPU busy %</th><th className="n">GPU mem GB</th><th className="n">GPU °C</th><th className="n">GPU W</th></tr></thead>
          <tbody>
            {events.map((e) => {
              const g = (e.gpu ?? null) as Record<string, unknown> | null;
              const gv = (k: string) => (g && isNum(g[k]) ? (g[k] as number).toFixed(0) : <NotApplicable why="No GPU reading on this machine." />);
              return (
                <tr key={e.ord} data-condition={isNum(e.refIdx) ? e.refIdx : undefined}>
                  <td className="n">{secs(e.tMs, from)}</td>
                  <td>{typeof e.thermal === "string" ? e.thermal : <Missing why="Not read." />}</td>
                  <td className="n">{isNum(e.swapGb) ? e.swapGb.toFixed(1) : <Missing why="Not read." />}</td>
                  <td className="n">{isNum(e.freePct) ? e.freePct.toFixed(0) : <Missing why="Not read." />}</td>
                  <td className="n">{isNum(e.footprintGb) ? e.footprintGb.toFixed(1) : <Missing why="Not read." />}</td>
                  <td className="n">{gv("busyPct")}</td><td className="n">{gv("memGb")}</td><td className="n">{gv("tempC")}</td><td className="n">{gv("powerW")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}
