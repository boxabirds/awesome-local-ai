// The small pieces the run and story-run pages are built from: every label and hover from the glossary, a missing
// number as "—" with why, and "live" and "of record" marked so they can't be confused.
import type { ReactNode } from "react";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";

/** A number that isn't there: "—", with why on hover (and on keyboard focus). Never a 0. */
export function Missing({ why }: { why: string }) {
  return <span className="missing" tabIndex={0} data-tip={why} aria-label={`not available: ${why}`}>—</span>;
}

/** A label from the glossary, with its definition on hover. */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  return <span className="term" data-tip={GLOSSARY[id].what}>{children ?? GLOSSARY[id].name}</span>;
}

/** A page section headed by its glossary term. `aside` sits on the heading's right (a control, a count). */
export function Section({ term, id, aside, children }: { term: TermId; id: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rp-section" data-section={id} aria-labelledby={`h-${id}`}>
      <div className="rp-head">
        <h2 id={`h-${id}`}><Term id={term} /></h2>
        {aside ? <div className="rp-aside">{aside}</div> : null}
      </div>
      <div className="rp-body">{children}</div>
    </section>
  );
}

/** Live: provisional, lighter, and never ranks anything. */
export function LiveTag() {
  return <span className="tag tag-live" data-tip={GLOSSARY.liveHeldOut.what}>live</span>;
}

/** Of record: the re-score of a finished run, the number to rank by. */
export function RecordTag() {
  return <span className="tag tag-record" data-tip={GLOSSARY.scoreOfRecord.what}>of record</span>;
}

/** One figure with its glossary label: a number, or Missing. */
export function Stat({ term, children, sub, tag }: { term: TermId; children: ReactNode; sub?: ReactNode; tag?: ReactNode }) {
  return (
    <div className="stat" data-stat={term}>
      <div className="stat-label"><Term id={term} />{tag}</div>
      <div className="stat-value">{children}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

const ISO_MINUTE = 16;
const MS_PER_S = 1000;

/** "2026-09-30 15:28 UTC" from an ISO time; from Unix seconds with `unix`. */
export function utc(t: string | number): string {
  const iso = typeof t === "number" ? new Date(t * MS_PER_S).toISOString() : t;
  return `${iso.slice(0, ISO_MINUTE).replace("T", " ")} UTC`;
}

/** 328750 -> "328,750". */
export const full = (n: number) => Math.round(n).toLocaleString("en-GB");
