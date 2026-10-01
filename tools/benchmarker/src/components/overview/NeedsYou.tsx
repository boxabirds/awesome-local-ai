// "Needs you": what a person must act on now, each naming what it is about (a link to its page), what it affects and
// what to do (the command and where to run it, or the page to do it on). Nothing the system handles by itself is
// listed (shared/overviewView.ts), and when nothing needs a person the panel is one quiet line.
import { useEffect, useState, type ReactNode } from "react";
import type { Need, NeedKind, RunRef } from "../../../shared/overviewView.ts";
import { NEED_LEAD, needAdvice } from "../../../shared/needView.ts";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";
import { machineHref, runHref } from "../../../shared/routes.ts";
import { duration } from "../../format.ts";
import { MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";

const SECONDS_PER_MINUTE = 60;
/** How long the copy button says "Copied". */
const COPIED_MS = 2000;

/** Each kind's tag: its glossary term and the icon it is shown with. */
const TAG: Record<NeedKind, { term: TermId; icon: string }> = {
  silent: { term: "needSilent", icon: "⚠" },
  unreachable: { term: "needUnreachable", icon: "⚠" },
  ended: { term: "needEnded", icon: "✕" },
  idle: { term: "needIdle", icon: "●" },
  rescoreFault: { term: "needRescoreFault", icon: "⚠" },
  unscored: { term: "needUnscored", icon: "○" },
};

const Run = ({ run }: { run: RunRef }) => <RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} invalid={run.invalid} />;
const Resolve = ({ href, children }: { href: string; children: ReactNode }) => <a className="resolve" href={href}>{children} →</a>;

/** What the need is about, in one sentence, each entity a link to its page. */
function What({ need, now }: { need: Need; now: number }): ReactNode {
  switch (need.kind) {
    case "silent": return <><MachineLink machine={need.machine} />: <Run run={need.run} /> on <StoryRunLink pack={need.run.pack} stack={need.run.stack} runId={need.run.runId} story={need.story}>story {need.story}</StoryRunLink> has reported nothing for {duration(need.minutes * SECONDS_PER_MINUTE)}</>;
    case "unreachable": return <><MachineLink machine={need.machine} /> doesn't answer{need.error ? <span className="small">: {need.error}</span> : null}</>;
    case "ended": return <><Run run={need.run} /> {need.status} {duration(now - need.endedAt)} ago on <MachineLink machine={need.run.machine} />{need.note ? <span className="small">: {need.note}</span> : null}</>;
    case "idle": return <><MachineLink machine={need.machine} /> is idle: nothing running, nothing queued</>;
    case "rescoreFault": return <><Run run={need.run} /> was re-scored under <span className="mono">{need.suite}</span>, but the re-score gave no score of record</>;
    case "unscored": return <><Run run={need.run} /> finished, not scored: {need.why}</>;
  }
}

/** The page where the need is seen and, for those done in the app, resolved. */
function Where({ need }: { need: Need }): ReactNode {
  switch (need.kind) {
    case "silent": return <Resolve href={machineHref(need.machine)}>stop it or read its log on {need.machine}</Resolve>;
    case "unreachable": return <Resolve href={machineHref(need.machine)}>its page</Resolve>;
    case "ended": return <Resolve href={machineHref(need.run.machine)}>restart it on {need.run.machine}</Resolve>;
    case "idle": return <Resolve href={machineHref(need.machine)}>queue a run</Resolve>;
    case "rescoreFault": return <Resolve href={runHref(need.run.pack, need.run.stack, need.run.runId)}>its score</Resolve>;
    case "unscored": return <Resolve href={runHref(need.run.pack, need.run.stack, need.run.runId)}>the run</Resolve>;
  }
}

/** A command to run elsewhere: shown whole, with a button that copies it. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {}); };
  return (
    <span className="need-run">
      <code className="need-command">{text}</code>
      <button type="button" className="need-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy the command"}>{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}

function Item({ need, now }: { need: Need; now: number }) {
  const tag = TAG[need.kind];
  const advice = needAdvice(need);
  return (
    <li data-need={need.kind}>
      <span className={`need-tag k-${need.kind}`} tabIndex={0} data-tip={GLOSSARY[tag.term].what}>
        <span aria-hidden="true">{tag.icon} </span>{need.kind === "ended" ? need.status : GLOSSARY[tag.term].name}
      </span>
      <div className="need-body">
        <p className="need-what"><What need={need} now={now} /></p>
        {advice.detail ? <p className="need-detail">{advice.detail}</p> : null}
        <p className="need-affects">{advice.affects}</p>
        <p className="need-todo"><b className="need-lead">{NEED_LEAD}:</b> {advice.todo}</p>
        {advice.command ? <Command text={advice.command} /> : null}
        {advice.caution ? <p className="need-caution">{advice.caution}</p> : null}
      </div>
      <Where need={need} />
    </li>
  );
}

/** `context`: the pack and version the run exceptions are over, to say so. */
export function NeedsYou({ needs, now, context }: { needs: Need[]; now: number; context: string }) {
  if (needs.length === 0) {
    return (
      <section className="ov-section needs-you" data-section="needs" aria-label={GLOSSARY.needsYou.name}>
        <p className="all-well">✓ Nothing needs you right now.</p>
      </section>
    );
  }
  return (
    <section className="ov-section needs-you" data-section="needs" aria-labelledby="h-needs">
      <h2 id="h-needs">
        <span className="term" data-tip={GLOSSARY.needsYou.what}>{GLOSSARY.needsYou.name}</span>
        <span className="count" data-count={needs.length}>{needs.length}</span>
        <span className="small">machines: all · runs: {context}</span>
      </h2>
      <ul className="needs" aria-labelledby="h-needs">{needs.map((n) => <Item key={n.key} need={n} now={now} />)}</ul>
    </section>
  );
}
