// Where the time went: the one definition of how a time split is drawn, used by every bar on every page (the story
// page, the run and story-run pages' SplitBar, the combination page's per-run bars). The parts, their order and their
// glossary terms are shared/runView.ts's SEGMENTS; their names and definitions are the glossary's; their colours are
// the `seg-<part>` classes in styles.css; a part's hover is segmentHover below.
import type { ReactNode } from "react";
import type { TimeSplit, Usage } from "../../shared/types.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { SEGMENTS, segmentTip, type Seg } from "../../shared/runView.ts";

export { SEGMENTS, type Seg };

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** Tool kinds under this many seconds are left out of the Tools hover, except the agent's own tests. */
const KIND_MIN_SECONDS = SECONDS_PER_MINUTE / 10;

const TEST_KINDS = new Set(["unit", "e2e", "component", "integration", "test"]);
const KIND_NAME: Record<string, string> = { e2e: "end-to-end", unit: "unit", component: "component", integration: "integration", build: "builds", read: "reading files", edit: "editing files", write: "writing files", bash: "other commands" };
const tenths = (s: number) => (s / SECONDS_PER_MINUTE).toFixed(1);

/** "the agent's tests 5.4 min (unit 3.5, end-to-end 1.9), builds 0.4, other commands 13.6 min": biggest first; "" for none. */
export function toolKindsText(kinds: Record<string, number>): string {
  const tests = Object.entries(kinds).filter(([k, v]) => TEST_KINDS.has(k) && v > 0).toSorted((a, b) => b[1] - a[1]);
  const rest = Object.entries(kinds).filter(([k, v]) => !TEST_KINDS.has(k) && v >= KIND_MIN_SECONDS).toSorted((a, b) => b[1] - a[1]);
  const parts: [number, string][] = rest.map(([k, v]) => [v, `${KIND_NAME[k] ?? k} ${tenths(v)}`]);
  const t = tests.reduce((a, [, v]) => a + v, 0);
  if (t > 0) parts.push([t, `the agent's tests ${tenths(t)} (${tests.map(([k, v]) => `${KIND_NAME[k] ?? k} ${tenths(v)}`).join(", ")})`]);
  return parts.length ? `${parts.toSorted((a, b) => b[0] - a[0]).map(([, s]) => s).join(", ")} min` : "";
}

/** One part of one story's split, on hover: its name, minutes and what explains it from the story's usage; for Tools,
 * what the agent waited on, by kind. */
export function segmentHover(seg: Seg, seconds: number, u: Usage | null | undefined): string {
  const base = segmentTip(seg, seconds, u ?? null);
  const kinds = seg === "tools" ? toolKindsText(u?.split?.toolsByKind ?? {}) : "";
  return kinds ? `${base}: ${kinds}` : base;
}

/** A part's name, from the glossary. */
export const segName = (seg: Seg) => GLOSSARY[SEGMENTS.find((s) => s.seg === seg)!.term].name;

/** A bar: the wall time drawn against a shared scale, split into its parts in the one order, each with its hover. */
export function SegmentBar({ parts, wall, scaleSeconds, tip, label }: {
  parts: Record<Seg, number>; wall: number; scaleSeconds: number; tip: (seg: Seg, seconds: number) => string; label?: string;
}) {
  return (
    <span className="bar" role={label ? "img" : undefined} aria-label={label} style={{ width: `${(wall / Math.max(1, scaleSeconds)) * PERCENT}%` }}>
      {SEGMENTS.filter((s) => parts[s.seg] > 0).map((s) => (
        <span key={s.seg} data-seg={s.seg} className={`seg seg-${s.seg}`} style={{ width: `${(parts[s.seg] / wall) * PERCENT}%` }} data-tip={tip(s.seg, parts[s.seg])} />
      ))}
    </span>
  );
}

/** One story's split as a bar, each part's hover from segmentHover. */
export function StorySplitBar({ split, usage, scaleSeconds, label }: { split: TimeSplit; usage: Usage | null | undefined; scaleSeconds: number; label?: string }) {
  return <SegmentBar parts={split} wall={split.wall} scaleSeconds={scaleSeconds} label={label} tip={(seg, s) => segmentHover(seg, s, usage)} />;
}

/** What each colour is: a swatch and the glossary's name per part, its definition on hover. */
export function SegmentKey() {
  return <>{SEGMENTS.map((s) => <span key={s.seg} className="legend" data-tip={`${GLOSSARY[s.term].name}: ${GLOSSARY[s.term].what}`}><i className={`seg-${s.seg}`} />{GLOSSARY[s.term].name}</span>)}</>;
}

/** One row of a figure of bars: a label, the bar on the shared scale, the total. */
export function BarRow({ label, split, usage, scaleSeconds, total, ...data }: {
  label: ReactNode; split: TimeSplit; usage: Usage | null | undefined; scaleSeconds: number; total: string; [data: `data-${string}`]: string;
}) {
  return (
    <div className="bar-row" {...data}>
      <span className="bar-label">{label}</span>
      <span className="bar-track"><StorySplitBar split={split} usage={usage} scaleSeconds={scaleSeconds} /></span>
      <span className="bar-total num">{total}</span>
    </div>
  );
}
