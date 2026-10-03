// A story run's conversation, happening by happening (plan section 4.4, as the time-range cursor API gives it).
// The page backfills the span and then follows along after its latest cursor; the story's status plays no part.
// Verbatim agent text is marked data-quoted="agent": it is a result, never the app's own words.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Row, State, Story } from "../../shared/types.ts";
import { CONVERSATION_VIEWS, cutText, matchesQuery, needsClamp, splitHighlights, timeline, type ConversationAnchor, type ConversationEvent, type ConversationView, type CutText } from "../../shared/conversation.ts";
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

const VIEW_KEY = "benchmarker:conv-view:v1";
const DEFAULT_VIEW: ConversationView = "time";
const loadView = (): ConversationView => { try { return localStorage.getItem(VIEW_KEY) === "type" ? "type" : DEFAULT_VIEW; } catch { return DEFAULT_VIEW; } };
const saveView = (v: ConversationView) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ } };
const callRowId = (idx: number) => `call-${idx}`;

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

/** Verbatim text from the agent's conversation: a result, marked as such; what matches the search is marked too. */
function Quoted({ text, className, query }: { text: string; className?: string; query?: string }) {
  const runs = splitHighlights(text, query ?? "");
  return <span className={`quoted ${className ?? ""}`} data-quoted="agent">{runs.map((r, i) => (r.hit ? <mark key={i}>{r.text}</mark> : r.text))}</span>;
}

/** A cell of conversation text: five lines, then a + button for the whole of what the page holds. */
function Clamped({ text, query, mono }: { text: string; query: string; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  const fold = needsClamp(text);
  return (
    <div className="clamp-cell">
      <div className={`clamp${mono ? " mono" : ""}`} data-expanded={fold && open ? "true" : "false"} data-folded={fold && !open ? "true" : undefined}>
        <Quoted text={text} query={query} />
      </div>
      {fold ? <button type="button" className="clamp-more" aria-expanded={open} aria-label={open ? "Show less" : "Show all"} onClick={() => setOpen((o) => !o)}>{open ? "−" : "+"}</button> : null}
    </div>
  );
}

/** What a call's Said cell shows: its text, else its thinking; and its thinking when that is what the search found. */
function said(e: ConversationEvent, withheld: boolean, query: string): string {
  const text = cutText(e.textBody as CutText).trim();
  const thinking = withheld ? "" : cutText(e.thinking as CutText | null).trim();
  const q = query.trim().toLowerCase();
  if (q && thinking && !text.toLowerCase().includes(q) && thinking.toLowerCase().includes(q)) return thinking;
  return text || thinking;
}

/** Rows that hold the query; all of them for none. */
const matching = (events: ConversationEvent[], query: string) => events.filter((e) => matchesQuery(e, query));

/** "154", or "3 of 154" while a search narrows the rows. */
const countText = (shown: number, total: number, query: string) => (query.trim() ? `${full(shown)} of ${full(total)}` : full(total));

export function ConversationPage({ run, story, storyId, state, params }: { run: Row; story: Story | null; storyId: string; state: State; params?: Record<string, string> }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const conv = useConversation(id && story?.hasConversation ? id : null);
  const at = params?.at;
  // A bar's part names a section, so the page opens by type then; otherwise the view last chosen (in order at first).
  const [view, setView] = useState<ConversationView>(() => (at ? "type" : loadView()));
  const chooseView = (v: ConversationView) => { setView(v); saveView(v); };
  const [jumped, setJumped] = useState<number | null>(null);
  useEffect(() => {
    if (at && conv.backfilled) document.getElementById(`sec-${at}`)?.scrollIntoView({ block: "start" });
  }, [at, conv.backfilled]);
  /** A timeline tick: to that call's row, marked, in whichever view is shown. */
  const jumpTo = (idx: number) => {
    setJumped(idx);
    document.getElementById(callRowId(idx))?.scrollIntoView({ block: "center" });
  };
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
      <Section term="conversationPage" id="conversation" aside={<>
        <span className="view-switch" role="group" aria-label="Layout">
          {CONVERSATION_VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={view === v.id} data-view={v.id} onClick={() => chooseView(v.id)}>{v.name}</button>)}
        </span>
        {s ? <span className="small" data-fact="range">{utc(from / MS_PER_S)} · {duration((toMs - from) / MS_PER_S)} · <span data-fact="events">{full(conv.events.length)}</span> events{s.complete ? "" : " so far"}</span> : null}
      </>}>
        <nav className="conv-sections" aria-label="Sections of the conversation">
          {SECTIONS.map((sec) => view === "type"
            ? <a key={sec.id} href={conversationHref(run.pack, run.stack, run.runId, storyId, sec.id)} data-anchor={sec.id} aria-current={at === sec.id ? "true" : undefined}>{GLOSSARY[sec.term].name} <span className="num">{of(sec.kinds).length}</span></a>
            : <span key={sec.id} data-anchor={sec.id}>{GLOSSARY[sec.term].name} <span className="num">{of(sec.kinds).length}</span></span>)}
        </nav>
        <figure className="conv-timeline" aria-label={GLOSSARY.callTimeline.name} data-tip={GLOSSARY.callTimeline.what}>
          {bins.map((b, i) => (
            b.firstCallIdx !== null
              ? <button key={i} type="button" className={`tick${b.compaction ? " compaction" : ""}`} onClick={() => jumpTo(b.firstCallIdx!)} style={{ height: `${Math.max(MIN_TICK_PERCENT, (b.calls / maxCalls) * PERCENT)}%` }} data-tip={`${secs(b.fromMs, from)}: ${b.calls} call${b.calls === 1 ? "" : "s"}${b.compaction ? ", compacted" : ""}. Click: to call ${b.firstCallIdx + 1} below`} aria-label={`${b.calls} calls at ${secs(b.fromMs, from)}: to call ${b.firstCallIdx + 1}`} />
              : <span key={i} className={`tick empty${b.compaction ? " compaction" : ""}`} style={{ height: `${MIN_TICK_PERCENT}%` }} data-tip={`${secs(b.fromMs, from)}: no call${b.compaction ? ", compacted" : ""}`} />
          ))}
        </figure>
      </Section>
      {view === "time" ? <InOrder events={conv.events} from={from} fmt={s?.fmt ?? null} link={link} jumped={jumped} /> : <>
        <Calls events={of(["call"])} from={from} fmt={s?.fmt ?? null} link={link} jumped={jumped} />
        <Tools events={of(["tool_start", "tool_end"])} from={from} link={link} />
        <Compactions events={of(["compaction_start", "compaction_end"])} from={from} />
        <Sessions events={of(["between_sessions"])} from={from} />
        <Messages events={of(["msg"])} from={from} />
        <Requests events={of(["request"])} from={from} link={link} />
        <Conditions events={of(["condition"])} from={from} />
      </>}
    </div>
  );
}

// ---- which sections are folded: remembered in the browser, like the run groups ----
const FOLD_KEY = "benchmarker:conv-folded:v1";
const foldListeners = new Set<() => void>();
let folded: Set<string> = (() => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]") as string[]); } catch { return new Set(); } })();
function setFolded(id: string, fold: boolean) {
  const next = new Set(folded);
  if (fold) next.add(id); else next.delete(id);
  folded = next;
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])); } catch { /* not remembered */ }
  for (const l of foldListeners) l();
}
const subscribeFold = (l: () => void) => { foldListeners.add(l); return () => { foldListeners.delete(l); }; };
const useFolded = (id: string) => useSyncExternalStore(subscribeFold, () => folded.has(id), () => false);

/** A section's own search, behind a magnifier where its count was. */
interface SecSearch { query: string; onChange: (q: string) => void; shown: number; total: number; label: string }

const Magnifier = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>;

function Sec({ id, term, count, search, children }: { id: ConversationAnchor; term: TermId; count: number; search?: SecSearch; children: ReactNode }) {
  const isFolded = useFolded(id);
  const [searching, setSearching] = useState(false);
  const name = GLOSSARY[term].name;
  const open = searching || (search?.query.trim() ?? "") !== "";
  return <section className="rp-section conv-section" id={`sec-${id}`} data-section={id} data-collapsed={isFolded ? "true" : "false"} aria-labelledby={`h-${id}`}>
    <div className="rp-head">
      <h2 id={`h-${id}`}>
        <button type="button" className="twisty" aria-expanded={!isFolded} aria-label={`${isFolded ? "Expand" : "Collapse"} ${name}`} onClick={() => setFolded(id, !isFolded)}>{isFolded ? "▸" : "▾"}</button>
        <Term id={term} />
      </h2>
      <div className="rp-aside">
        {search ? <span className="sec-search" data-open={open ? "true" : "false"}>
          {open ? <>
            <input type="search" role="searchbox" aria-label={search.label} placeholder="Search as you type" autoFocus value={search.query} onChange={(ev) => search.onChange(ev.target.value)} onBlur={() => { if (!search.query.trim()) setSearching(false); }} />
            <span className="num" data-fact="count">{countText(search.shown, search.total, search.query)}</span>
          </> : null}
          <button type="button" className="sec-search-toggle" aria-label={search.label} aria-expanded={open} onClick={() => { if (open) { search.onChange(""); setSearching(false); } else setSearching(true); }}><Magnifier /></button>
        </span> : <span className="num" data-fact="count">{full(count)}</span>}
      </div>
    </div>
    <div className="rp-body" hidden={isFolded}>{count ? children : <p className="rp-empty small">None.</p>}</div>
  </section>;
}

const KIND_NAME: Record<string, string> = { call: "model call", tool_start: "tool", tool_end: "tool done", msg: "message", compaction_start: "compaction", compaction_end: "compacted", between_sessions: "wait", request: "engine request", condition: "reading" };

/** One event's figures, briefly, for the in-order list. */
function figures(e: ConversationEvent, withheld: boolean): string {
  const n = (v: unknown) => (isNum(v) ? full(v) : "");
  switch (e.kind) {
    case "call": return [withheld ? "" : `${n(e.think)} thinking`, `${n(e.text)} text`, `${n(e.nTools)} tools`, isNum(e.inTok) ? `read ${full(e.inTok + (isNum(e.cacheTok) ? e.cacheTok : 0))}` : "", isNum(e.outTok) ? `wrote ${n(e.outTok)}` : "", typeof e.stop === "string" ? e.stop : ""].filter(Boolean).join(" · ");
    case "tool_start": return `${String(e.name ?? "")} (${String(e.toolKind ?? "")})`;
    case "tool_end": return [`${String(e.name ?? "")}`, e.error === 1 ? "failed" : "ok", isNum(e.seconds) ? `${e.seconds} s` : "", isNum(e.passed) ? `${e.passed} passed` : "", isNum(e.failed) ? `${e.failed} failed` : ""].filter(Boolean).join(" · ");
    case "compaction_start": return String(e.reason ?? "");
    case "compaction_end": return [String(e.reason ?? ""), isNum(e.seconds) ? `${e.seconds} s` : "", isNum(e.summaryChars) ? `summary ${full(e.summaryChars)} chars` : ""].filter(Boolean).join(" · ");
    case "between_sessions": return isNum(e.seconds) ? `waited ${e.seconds} s` : "";
    case "request": return [isNum(e.promptTok) ? `prompt ${full(e.promptTok)}` : "", isNum(e.generatedTok) ? `generated ${full(e.generatedTok)}` : "", isNum(e.decodeTokS) ? `${full(e.decodeTokS)} tok/s` : "", isNum(e.draftAccepted) && isNum(e.draftProposed) ? `drafts ${e.draftAccepted}/${e.draftProposed}` : ""].filter(Boolean).join(" · ");
    case "condition": return [typeof e.thermal === "string" ? e.thermal : "", isNum(e.freePct) ? `free ${e.freePct.toFixed(0)}%` : "", isNum(e.swapGb) ? `swap ${e.swapGb.toFixed(1)} GB` : ""].filter(Boolean).join(" · ");
    default: return "";
  }
}

/** Everything in time order: one row per happening, the text of each as the page holds it. */
function InOrder({ events, from, fmt, link, jumped }: { events: ConversationEvent[]; from: number; fmt: string | null; link: (i: number | string) => string; jumped: number | null }) {
  const withheld = fmt === "claude";
  const [query, setQuery] = useState("");
  const rows = matching(events, query);
  return (
    <Sec id="all" term="inOrder" count={events.length} search={{ query, onChange: setQuery, shown: rows.length, total: events.length, label: "Search the conversation" }}>
      <div className="table-scroll">
        <table className="rp-table conv-table in-order" aria-label={GLOSSARY.inOrder.name}>
          <thead><tr><th className="n">At</th><th>What</th><th>Figures</th><th className="said">Text</th></tr></thead>
          <tbody>
            {rows.map((e) => {
              const call = e.kind === "call" && isNum(e.refIdx) ? e.refIdx : null;
              const text = e.kind === "call" ? said(e, withheld, query) : e.kind === "tool_start" ? String(e.arg ?? "") : e.kind === "tool_end" ? cutText(e.result as CutText) : e.kind === "msg" ? cutText(e.textBody as CutText) : "";
              const toCall = e.kind !== "call" && isNum(e.callIdx) ? e.callIdx : null;
              return (
                <tr key={e.ord} id={call !== null ? callRowId(call) : undefined} data-kind={e.kind} data-call={call ?? undefined} data-jumped={call !== null && call === jumped ? "true" : undefined}>
                  <td className="n">{secs(e.tMs, from)}</td>
                  <td className="what"><span className={`kind kind-${e.kind}`}>{KIND_NAME[e.kind] ?? e.kind}</span>{call !== null ? <> <a className="entity call-link" href={link(call)}>call {call + 1}</a></> : toCall !== null ? <> <a className="entity call-link" href={link(toCall)}>call {toCall + 1}</a></> : null}</td>
                  <td className="figures small">{figures(e, withheld)}</td>
                  <td className="said">{text ? <Clamped text={text} query={query} mono={e.kind === "tool_start" || e.kind === "tool_end"} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function Calls({ events, from, fmt, link, jumped }: { events: ConversationEvent[]; from: number; fmt: string | null; link: (i: number | string) => string; jumped: number | null }) {
  const withheld = fmt === "claude";
  const [query, setQuery] = useState("");
  const rows = matching(events, query);
  return (
    <Sec id="calls" term="modelCall" count={events.length} search={{ query, onChange: setQuery, shown: rows.length, total: events.length, label: "Search model calls" }}>
      <div className="table-scroll">
        <table className="rp-table conv-table calls" aria-label={GLOSSARY.modelCall.name}>
          <thead><tr><th>Call</th><th className="n">At</th><th className="n">Thinking</th><th className="n">Text</th><th className="n">Tools</th><th className="n">Read</th><th className="n">Wrote</th><th>Stop</th><th className="said">Said</th></tr></thead>
          <tbody>
            {rows.map((e) => {
              const think = e.thinking as CutText | null | undefined;
              const idx = isNum(e.refIdx) ? e.refIdx : 0;
              return (
                <tr key={e.ord} id={callRowId(idx)} data-call={idx} data-sub={e.sub === 1 ? "true" : undefined} data-jumped={idx === jumped ? "true" : undefined}>
                  <td><a className="entity call-link" href={link(idx)}>call {idx + 1}</a>{e.sub === 1 ? <span className="small"> subagent</span> : null}</td>
                  <td className="n">{secs(e.tMs, from)}</td>
                  <td className="n">{withheld ? <NotApplicable why="This client withholds its thinking: the count isn't known." /> : num(e.think, "Not counted.")}</td>
                  <td className="n">{num(e.text, "Not counted.")}</td>
                  <td className="n">{num(e.nTools, "Not counted.")}</td>
                  <td className="n">{isNum(e.inTok) ? full(e.inTok + (isNum(e.cacheTok) ? e.cacheTok : 0)) : <Missing why="The client didn't report this call's tokens." />}</td>
                  <td className="n">{num(e.outTok, "The client didn't report this call's tokens.")}</td>
                  <td>{typeof e.stop === "string" ? e.stop : <Missing why="The client didn't report why the call stopped." />}</td>
                  <td className="said"><Clamped text={said(e, withheld, query)} query={query} /></td>
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
  const [query, setQuery] = useState("");
  // A tool call matches on its argument or its result.
  const rows = starts.filter((e) => { const end = ends.get(e.refIdx); return matchesQuery(e, query) || (end !== undefined && matchesQuery(end, query)); });
  return (
    <Sec id="tools" term="toolCall" count={starts.length} search={{ query, onChange: setQuery, shown: rows.length, total: starts.length, label: "Search tool calls" }}>
      <div className="table-scroll">
        <table className="rp-table conv-table tools" aria-label={GLOSSARY.toolCall.name}>
          <thead><tr><th>Tool</th><th>Kind</th><th className="n">At</th><th className="n">Seconds</th><th>Outcome</th><th className="said">Argument</th><th className="said">Result</th><th>Call</th></tr></thead>
          <tbody>
            {rows.map((e) => {
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
                  <td className="said"><Clamped text={String(e.arg ?? "")} query={query} mono /></td>
                  <td className="said">{end ? <Clamped text={cutText(end.result as CutText)} query={query} mono /> : <Missing why="This tool call has no result yet." />}</td>
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
      <ul className="conv-list messages">{events.map((e) => <li key={e.ord} data-msg={isNum(e.refIdx) ? e.refIdx : undefined}><span className="num">{secs(e.tMs, from)}</span> <Clamped text={cutText(e.textBody as CutText)} query="" /></li>)}</ul>
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
