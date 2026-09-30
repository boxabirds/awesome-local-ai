// "Needs you": every exception that asks for action, one line each, naming what it is about (each a link to its
// page) and linking to where it is resolved.
import type { ReactNode } from "react";
import type { Need, NeedKind, RunRef } from "../../../shared/overviewView.ts";
import { GLOSSARY, type TermId } from "../../../shared/glossary.ts";
import { machineHref, runHref, storyRunHref } from "../../../shared/routes.ts";
import { duration } from "../../format.ts";
import { MachineLink, RunLink, StoryRunLink } from "../EntityLinks.tsx";

const SECONDS_PER_MINUTE = 60;

/** Each kind's tag: its glossary term and the icon it is shown with. */
const TAG: Record<NeedKind, { term: TermId; icon: string }> = {
  silent: { term: "needSilent", icon: "⚠" },
  unreachable: { term: "needUnreachable", icon: "⚠" },
  ended: { term: "needEnded", icon: "✕" },
  idle: { term: "needIdle", icon: "●" },
  rescoreFault: { term: "needRescoreFault", icon: "⚠" },
  unscored: { term: "needUnscored", icon: "○" },
  accounting: { term: "needAccounting", icon: "⚑" },
};

const Run = ({ run }: { run: RunRef }) => <RunLink pack={run.pack} stack={run.stack} runId={run.runId} label={run.label} invalid={run.invalid} />;
const Resolve = ({ href, children }: { href: string; children: ReactNode }) => <a className="resolve" href={href}>{children} →</a>;

function Line({ need, now }: { need: Need; now: number }): ReactNode {
  switch (need.kind) {
    case "silent": return <>
      <span className="need-what"><MachineLink machine={need.machine} />: <Run run={need.run} /> on <StoryRunLink pack={need.run.pack} stack={need.run.stack} runId={need.run.runId} story={need.story}>story {need.story}</StoryRunLink> has reported nothing for {duration(need.minutes * SECONDS_PER_MINUTE)}</span>
      <Resolve href={machineHref(need.machine)}>stop it or read its log on {need.machine}</Resolve>
    </>;
    case "unreachable": return <>
      <span className="need-what"><MachineLink machine={need.machine} /> doesn't answer{need.error ? <span className="small">: {need.error}</span> : null}</span>
      <Resolve href={machineHref(need.machine)}>its page</Resolve>
    </>;
    case "ended": return <>
      <span className="need-what"><Run run={need.run} /> {need.status} {duration(now - need.endedAt)} ago on <MachineLink machine={need.run.machine} />{need.note ? <span className="small">: {need.note}</span> : null}</span>
      <Resolve href={machineHref(need.run.machine)}>restart it on {need.run.machine}</Resolve>
    </>;
    case "idle": return <>
      <span className="need-what"><MachineLink machine={need.machine} /> is idle: nothing running, nothing queued</span>
      <Resolve href={machineHref(need.machine)}>queue a run</Resolve>
    </>;
    case "rescoreFault": return <>
      <span className="need-what"><Run run={need.run} /> was re-scored under <span className="mono">{need.suite}</span>, but the re-score gave no score of record</span>
      <Resolve href={runHref(need.run.pack, need.run.stack, need.run.runId)}>its score</Resolve>
    </>;
    case "unscored": return <>
      <span className="need-what"><Run run={need.run} /> finished, not scored: {need.why}</span>
      <Resolve href={runHref(need.run.pack, need.run.stack, need.run.runId)}>the run</Resolve>
    </>;
    case "accounting": return <>
      <span className="need-what"><Run run={need.run} />: the time accounting failed its checks on {need.stories.map((s, i) => (
        <span key={s.id}>{i ? ", " : ""}<span data-tip={s.problems.join("; ") || "no problem recorded"}><StoryRunLink pack={need.run.pack} stack={need.run.stack} runId={need.run.runId} story={s.id}>story {s.id}</StoryRunLink></span></span>
      ))}</span>
      <Resolve href={storyRunHref(need.run.pack, need.run.stack, need.run.runId, need.stories[0].id)}>{need.stories.length === 1 ? "the story run" : `story ${need.stories[0].id} first`}</Resolve>
    </>;
  }
}

/** `context`: the pack and version the run exceptions are over, to say so. */
export function NeedsYou({ needs, now, context }: { needs: Need[]; now: number; context: string }) {
  return (
    <section className="ov-section needs-you" data-section="needs" aria-labelledby="h-needs">
      <h2 id="h-needs">
        <span className="term" data-tip={GLOSSARY.needsYou.what}>{GLOSSARY.needsYou.name}</span>
        <span className="count" data-count={needs.length}>{needs.length}</span>
        <span className="small">machines: all · runs: {context}</span>
      </h2>
      {needs.length === 0 ? <p className="all-well">✓ Nothing needs you.</p> : (
        <ul className="needs">
          {needs.map((n) => (
            <li key={n.key} data-need={n.kind}>
              <span className={`need-tag k-${n.kind}`} tabIndex={0} data-tip={GLOSSARY[TAG[n.kind].term].what}>
                <span aria-hidden="true">{TAG[n.kind].icon} </span>{n.kind === "ended" ? n.status : GLOSSARY[TAG[n.kind].term].name}
              </span>
              <Line need={n} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
