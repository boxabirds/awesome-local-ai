// A story run's conversation: an overview that navigates it (what kinds to show, what text, what span of time),
// over one list of its turns in time order. The story's status plays no part: the page backfills the span and then
// follows along after its latest cursor. Verbatim agent text is marked data-quoted="agent": a result, never the
// app's own words.
import { useEffect, useRef, useState } from "react";
import type { Row, State, Story } from "../../shared/types.ts";
import { clock, cutText, kindsFromParam, nearestTurn, strip, turnShown, turns, TURN_KINDS, type ConversationEvent, type CutText, type ToolTurn, type Turn, type TurnKind } from "../../shared/conversation.ts";
import { callHref } from "../../shared/routes.ts";
import { storyRunState, storyTitle } from "../../shared/runView.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { Breadcrumb, CombinationLink, RunLink, StoryRunLink } from "../components/EntityLinks.tsx";
import { StoryRunHeader } from "../components/run/StoryRunParts.tsx";
import { Missing, Section, Term, full, utc } from "../components/run/bits.tsx";
import { Clamped } from "../components/conversation/text.tsx";
import { duration } from "../format.ts";
import { useConversation } from "../useConversation.ts";
import { useHeightVar } from "../useHeightVar.ts";
import "./run.css";
import "./conversation.css";

const MS_PER_S = 1000;
/** The strip's drawing space: a click within this many pixels of its press is a click, not a drag. */
const STRIP_W = 1000;
const STRIP_H = 60;
const STRIP_BASE = 52;
const STRIP_CALL_H = 44;
const STRIP_TOOL_H = 6;
const DRAG_PX = 4;
const MIN_MARK_W = 2;
export const NOT_AVAILABLE = "Not available.";
const callRowId = (idx: number) => `call-${idx}`;

const isNum = (v: unknown): v is number => typeof v === "number";
const n = (v: unknown) => (isNum(v) ? full(v) : "");

export function ConversationPage({ run, story, storyId, state, params }: { run: Row; story: Story | null; storyId: string; state: State; params?: Record<string, string> }) {
  const st = storyRunState(run, storyId);
  const title = storyTitle(run, state.rows, storyId);
  const id = story?.storyRunId ?? null;
  const conv = useConversation(id && story?.hasConversation ? id : null);
  const [kinds, setKinds] = useState<Set<TurnKind>>(() => kindsFromParam(params?.kind));
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<[number, number] | null>(null);
  const [jumped, setJumped] = useState<number | null>(null);
  // The one header is pinned; the column heads pin under it, so its height is kept in a variable for them.
  const head = useHeightVar<HTMLDivElement>("--conv-head-h");
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
  const toMs = s ? Math.max(s.range.toMs, ...conv.events.map((e) => e.tMs + 1)) : from + 1;
  const all = turns(conv.events);
  const filter = { kinds, query, range };
  const shown = all.map((t, i) => [t, i] as const).filter(([t]) => turnShown(t, filter));
  const count = (k: TurnKind) => all.filter((t) => (k === "tool" ? t.kind === "tool" || t.tools.length > 0 : t.kind === k)).reduce((a, t) => a + (k === "tool" ? (t.kind === "tool" ? 1 : t.tools.length) : 1), 0);
  const toggle = (k: TurnKind) => setKinds((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const everyKind = kinds.size === TURN_KINDS.length;
  const link = (call: number) => callHref(run.pack, run.stack, run.runId, storyId, call);
  const jumpTo = (turn: number) => {
    setJumped(turn);
    const t = all[turn];
    const el = t?.callIdx !== null && t?.callIdx !== undefined ? document.getElementById(callRowId(t.callIdx)) : document.getElementById(`turn-${turn}`);
    el?.scrollIntoView({ block: "center" });
  };
  const withheld = s?.fmt === "claude";
  return (
    <div className="page conversation-page run-page" data-page="conversation" data-available="true" data-backfilled={conv.backfilled ? "true" : "false"} data-polls={conv.polls}>
      <Breadcrumb trail={crumbs} />
      <StoryRunHeader run={run} st={st} storyId={storyId} title={title} />
      <section className="rp-section conv-section" id="sec-all" data-section="all" aria-labelledby="h-all">
        <div className="rp-head conv-head" ref={head}>
          <div className="conv-head-row">
            <h2 id="h-all"><Term id="conversationPage" /></h2>
            <div className="rp-aside">
              <span className="num" data-fact="count">{shown.length === all.length ? full(all.length) : `${full(shown.length)} of ${full(all.length)} shown`}</span>
              {s ? <span className="small" data-fact="range">{utc(from / MS_PER_S)} · {duration((toMs - from) / MS_PER_S)} · <span data-fact="events">{full(conv.events.length)}</span> events{s.complete ? "" : " so far"}</span> : null}
            </div>
          </div>
          <div className="conv-controls">
            <div className="conv-chips" role="group" aria-label="Kinds shown">
              {TURN_KINDS.map((k) => <button key={k.id} type="button" className={`chip chip-${k.id}`} data-kind={k.id} aria-pressed={kinds.has(k.id)} onClick={() => toggle(k.id)}><i aria-hidden="true" />{k.name} <span className="num">{full(count(k.id))}</span></button>)}
              {everyKind ? null : <button type="button" className="chip-reset" onClick={() => setKinds(kindsFromParam(undefined))}>all kinds</button>}
            </div>
            <input type="search" role="searchbox" aria-label="Search the conversation" placeholder="Search the conversation" value={query} onChange={(ev) => setQuery(ev.target.value)} />
          </div>
          <Strip all={all} from={from} toMs={toMs} range={range} onJump={jumpTo} onRange={setRange} />
        </div>
        <div className="rp-body">
          {all.length === 0 ? <p className="rp-empty small">None.</p> : (
            <div className="table-scroll">
              <table className="rp-table conv-table turns" aria-label={GLOSSARY.inOrder.name}>
                <thead><tr><th className="n">At</th><th className="what">Turn</th><th className="said">Text</th></tr></thead>
                <tbody>
                  {shown.flatMap(([t, i]) => rowsOf(t, i, { from, link, query, kinds, withheld, jumped: jumped === i }))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

interface RowCtx { from: number; link: (call: number) => string; query: string; kinds: Set<TurnKind>; withheld: boolean; jumped: boolean }

/** The rows of one turn: a call's row then one line per tool it called; a tool no call owns as its own line. */
function rowsOf(t: Turn, i: number, c: RowCtx) {
  const toolLines = (tools: ToolTurn[], parent: number | null) => tools
    .filter((x) => !c.query.trim() || [x.start, x.end].some((e) => e && eventTextHas(e, c.query)) || (parent !== null && !c.kinds.has("call")))
    .map((x) => <ToolLine key={`t${x.idx}`} tool={x} parent={parent} ctx={c} />);
  if (t.kind === "call") {
    const callRow = c.kinds.has("call") ? [<CallRow key={`c${t.callIdx}`} t={t} i={i} ctx={c} />] : [];
    return [...callRow, ...(c.kinds.has("tool") ? toolLines(t.tools, t.callIdx) : [])];
  }
  if (t.kind === "tool") return toolLines(t.tools, null);
  return [<OtherRow key={`o${i}`} t={t} i={i} ctx={c} />];
}

const eventTextHas = (e: ConversationEvent, q: string) => {
  const text = e.kind === "tool_start" ? String(e.arg ?? "") : e.kind === "tool_end" ? cutText(e.result as CutText) : "";
  return text.toLowerCase().includes(q.trim().toLowerCase());
};

/** What a call's Text cell shows: its text, else its thinking; and its thinking when that is what the search found. */
function said(e: ConversationEvent, withheld: boolean, query: string): string {
  const text = cutText(e.textBody as CutText).trim();
  const thinking = withheld ? "" : cutText(e.thinking as CutText | null).trim();
  const q = query.trim().toLowerCase();
  if (q && thinking && !text.toLowerCase().includes(q) && thinking.toLowerCase().includes(q)) return thinking;
  return text || thinking;
}

function CallRow({ t, i, ctx }: { t: Turn; i: number; ctx: RowCtx }) {
  const e = t.event;
  const r = t.request;
  const figures = [
    ctx.withheld ? "" : `${n(e.think)} thinking`, `${n(e.text)} text`, t.tools.length ? `${t.tools.length} tool${t.tools.length === 1 ? "" : "s"}` : "",
    isNum(e.inTok) ? `read ${full(e.inTok + (isNum(e.cacheTok) ? e.cacheTok : 0))}` : "", isNum(e.outTok) ? `wrote ${n(e.outTok)}` : "",
    r && isNum(r.decodeTokS) ? `${n(r.decodeTokS)} tok/s` : "", r && isNum(r.draftAccepted) && isNum(r.draftProposed) ? `drafts ${r.draftAccepted}/${r.draftProposed}` : "",
    typeof e.stop === "string" ? e.stop : "",
  ].filter(Boolean).join(" · ");
  const idx = t.callIdx ?? 0;
  return (
    <tr id={callRowId(idx)} data-turn={i} data-kind="call" data-call={idx} data-sub={e.sub === 1 ? "true" : undefined} data-jumped={ctx.jumped ? "true" : undefined}>
      <td className="n">{clock(t.tMs, ctx.from)}</td>
      <td className="what"><span className="kind kind-call">model call</span> <a className="entity call-link" href={ctx.link(idx)}>call {idx + 1}</a>{e.sub === 1 ? <span className="small"> subagent</span> : null}<div className="figures small">{figures}</div></td>
      <td className="said"><Clamped text={said(e, ctx.withheld, ctx.query)} query={ctx.query} /></td>
    </tr>
  );
}

function ToolLine({ tool, parent, ctx }: { tool: ToolTurn; parent: number | null; ctx: RowCtx }) {
  const s = tool.start;
  const end = tool.end;
  const counts = end && isNum(end.passed) ? ` · ${end.passed} passed${isNum(end.failed) ? `, ${end.failed} failed` : ""}` : "";
  const outcome = end ? `${end.error === 1 ? "failed" : "ok"}${isNum(end.seconds) ? ` · ${end.seconds} s` : ""}${counts}` : "";
  return (
    <tr className="tool-line" data-kind="tool" data-tool={tool.idx} data-parent={parent ?? undefined} data-error={end?.error === 1 ? "true" : undefined} data-open={end ? undefined : "true"}>
      <td className="n">{clock(s.tMs, ctx.from)}</td>
      <td className="what"><span className="kind kind-tool">tool</span> <span className="mono">{String(s.name ?? "")}</span> <span className="small">{String(s.toolKind ?? "")}</span>{parent === null && isNum(s.callIdx) ? <> <a className="entity call-link" href={ctx.link(s.callIdx)}>call {s.callIdx + 1}</a></> : null}<div className="figures small">{outcome || <Missing why="This tool call has no end yet." />}</div></td>
      <td className="said">
        <Clamped text={String(s.arg ?? "")} query={ctx.query} mono />
        {end ? <Clamped text={cutText(end.result as CutText)} query={ctx.query} mono /> : null}
      </td>
    </tr>
  );
}

function OtherRow({ t, i, ctx }: { t: Turn; i: number; ctx: RowCtx }) {
  const e = t.event;
  let what = "";
  let figures = "";
  let text = "";
  switch (t.kind) {
    case "msg": what = "message"; text = cutText(e.textBody as CutText); break;
    case "compaction": what = "compaction"; figures = [String(e.reason ?? ""), t.end && isNum(t.end.seconds) ? `${t.end.seconds} s` : "", t.end && isNum(t.end.summaryChars) ? `summary ${full(t.end.summaryChars)} chars` : ""].filter(Boolean).join(" · "); break;
    case "wait": what = "wait"; figures = isNum(e.seconds) ? `waited ${e.seconds} s` : ""; break;
    case "request": what = "engine request"; figures = [isNum(e.promptTok) ? `prompt ${full(e.promptTok)}` : "", isNum(e.generatedTok) ? `generated ${full(e.generatedTok)}` : "", isNum(e.decodeTokS) ? `${full(e.decodeTokS)} tok/s` : ""].filter(Boolean).join(" · ") || "no call of this story matched it"; break;
    case "condition": what = "reading"; figures = [typeof e.thermal === "string" ? e.thermal : "", isNum(e.freePct) ? `free ${e.freePct.toFixed(0)}%` : "", isNum(e.swapGb) ? `swap ${e.swapGb.toFixed(1)} GB` : "", e.gpu && typeof e.gpu === "object" && isNum((e.gpu as Record<string, unknown>).busyPct) ? `GPU ${((e.gpu as Record<string, unknown>).busyPct as number).toFixed(0)}%` : ""].filter(Boolean).join(" · "); break;
    default: what = t.kind;
  }
  return (
    <tr id={`turn-${i}`} data-turn={i} data-kind={t.kind} data-jumped={ctx.jumped ? "true" : undefined}>
      <td className="n">{clock(t.tMs, ctx.from)}</td>
      <td className="what"><span className={`kind kind-${t.kind}`}>{what}</span>{figures ? <div className="figures small">{figures}</div> : null}</td>
      <td className="said">{text ? <Clamped text={text} query={ctx.query} /> : null}</td>
    </tr>
  );
}

/** The strip: calls as bars from send to end (height by output), tools as a band, compactions as lines; a click
 * jumps to the nearest turn, a drag narrows the list to that span. */
function Strip({ all, from, toMs, range, onJump, onRange }: { all: Turn[]; from: number; toMs: number; range: [number, number] | null; onJump: (turn: number) => void; onRange: (r: [number, number] | null) => void }) {
  const marks = strip(all, { fromMs: from, toMs });
  const svg = useRef<SVGSVGElement>(null);
  const press = useRef<{ x: number; frac: number } | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const frac = (clientX: number) => { const r = svg.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width))); };
  const atFrac = (f: number) => from + f * (toMs - from);
  const sel = drag ?? (range ? [(range[0] - from) / Math.max(1, toMs - from), (range[1] - from) / Math.max(1, toMs - from)] as [number, number] : null);
  return (
    <div className="conv-strip-wrap">
      <svg ref={svg} className="conv-strip" viewBox={`0 0 ${STRIP_W} ${STRIP_H}`} preserveAspectRatio="none" role="img" aria-label={GLOSSARY.callTimeline.name}
        onPointerDown={(ev) => { press.current = { x: ev.clientX, frac: frac(ev.clientX) }; svg.current?.setPointerCapture(ev.pointerId); }}
        onPointerMove={(ev) => { if (!press.current) return; const f = frac(ev.clientX); if (Math.abs(ev.clientX - press.current.x) >= DRAG_PX) setDrag([Math.min(press.current.frac, f), Math.max(press.current.frac, f)]); }}
        onPointerUp={(ev) => {
          const p = press.current; press.current = null; setDrag(null);
          if (!p) return;
          if (Math.abs(ev.clientX - p.x) < DRAG_PX) { const t = nearestTurn(all, atFrac(p.frac)); if (t !== null) onJump(t); return; }
          const f = frac(ev.clientX);
          onRange([atFrac(Math.min(p.frac, f)), atFrac(Math.max(p.frac, f))]);
        }}>
        <line x1="0" y1={STRIP_BASE} x2={STRIP_W} y2={STRIP_BASE} className="strip-base" />
        {marks.map((m, i) => m.kind === "tool"
          ? <rect key={i} className="strip-tool" x={m.x0 * STRIP_W} y={STRIP_BASE + 1} width={Math.max(MIN_MARK_W, (m.x1 - m.x0) * STRIP_W)} height={STRIP_TOOL_H} data-turn={m.turn}><title>{m.label}</title></rect>
          : m.kind === "compaction"
            ? <line key={i} className="strip-compaction" x1={m.x0 * STRIP_W} y1={0} x2={m.x0 * STRIP_W} y2={STRIP_H} data-turn={m.turn}><title>{m.label}</title></line>
            : <rect key={i} className="strip-call" x={m.x0 * STRIP_W} y={STRIP_BASE - m.h * STRIP_CALL_H} width={Math.max(MIN_MARK_W, (m.x1 - m.x0) * STRIP_W)} height={m.h * STRIP_CALL_H} data-turn={m.turn}><title>{m.label}</title></rect>)}
        {sel ? <rect className="strip-range" x={sel[0] * STRIP_W} y={0} width={Math.max(1, (sel[1] - sel[0]) * STRIP_W)} height={STRIP_H} /> : null}
      </svg>
      <div className="conv-strip-legend small">
        <span><i className="sw sw-call" />model calls (height: output)</span><span><i className="sw sw-tool" />tool calls</span><span><i className="sw sw-compaction" />compaction</span>
        <span className="hint">click: to that turn · drag: only that span</span>
        {range ? <button type="button" className="chip-reset" data-fact="range-filter" onClick={() => onRange(null)}>{clock(range[0], from)} to {clock(range[1], from)} ×</button> : null}
      </div>
    </div>
  );
}
