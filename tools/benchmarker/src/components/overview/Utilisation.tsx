// The utilisation timeline: one lane per machine over the last day, each run a segment, the gaps left empty so idle
// time is as visible as work. A machine runs one job at a time, so a segment starts when the machine was free, not
// when the job was queued (shared/dashboardView.ts). Facts of normal operation, with no cause or remedy attached.
import type { Row } from "../../../shared/types.ts";
import { utilisation, type UtilisationSegment } from "../../../shared/dashboardView.ts";
import { GLOSSARY } from "../../../shared/glossary.ts";
import { machineHref, runHref } from "../../../shared/routes.ts";
import { duration } from "../../format.ts";

const PERCENT = 100;
const HOURS = 24;
const SECONDS_PER_HOUR = 3600;
/** A tick every this many hours along the axis. */
const TICK_HOURS = 6;

const pct = (n: number) => `${(n * PERCENT).toFixed(3)}%`;

function Segment({ s, from, span }: { s: UtilisationSegment; from: number; span: number }) {
  const tip = `${s.label} ${s.runId}: ${duration(s.to - s.from)}${s.running ? ", still running" : ""}`;
  return (
    <a className={`util-seg${s.running ? " util-running" : ""}`} data-run={s.runId} href={runHref(s.pack, s.stack, s.runId)}
       style={{ left: pct((s.from - from) / span), width: pct((s.to - s.from) / span) }} data-tip={tip} aria-label={tip} />
  );
}

export function Utilisation({ rows, now }: { rows: Row[]; now: number }) {
  const u = utilisation(rows, now, HOURS * SECONDS_PER_HOUR);
  if (u.lanes.length === 0) return null;
  const span = u.to - u.from;
  const ticks = Array.from({ length: HOURS / TICK_HOURS }, (_, i) => (i + 1) * TICK_HOURS);
  return (
    <section className="ov-section util" data-section="utilisation" aria-labelledby="h-util">
      <h2 id="h-util"><span className="term" data-tip={GLOSSARY.utilisation.what}>{GLOSSARY.utilisation.name}</span> <span className="small">the last {HOURS} hours</span></h2>
      <div className="util-lanes">
        {u.lanes.map((lane) => (
          <div key={lane.machine} className="util-lane" data-machine={lane.machine}>
            <a className="util-name entity" href={machineHref(lane.machine)}>{lane.machine}</a>
            <div className="util-track" role="img"
                 aria-label={`${lane.machine}: running ${duration(lane.busySeconds)} of the last ${HOURS} hours, ${lane.segments.length} run${lane.segments.length === 1 ? "" : "s"}`}>
              {ticks.map((h) => <i key={h} className="util-tick" style={{ left: pct(1 - (h * SECONDS_PER_HOUR) / span) }} />)}
              {lane.segments.map((s) => <Segment key={`${s.runId}-${s.from}`} s={s} from={u.from} span={span} />)}
            </div>
            <span className="util-busy small" data-tip={`Running ${duration(lane.busySeconds)} of the last ${HOURS} hours`}>
              {Math.round((lane.busySeconds / span) * PERCENT)}%
            </span>
          </div>
        ))}
      </div>
      {/* The same facts in words, for a reader who cannot use the picture. */}
      <ul className="util-words small">
        {u.lanes.map((lane) => (
          <li key={lane.machine}>{lane.machine}: ran {duration(lane.busySeconds)} of the last {HOURS} hours, over {lane.segments.length} run{lane.segments.length === 1 ? "" : "s"}</li>
        ))}
      </ul>
      <p className="util-axis small"><span>{HOURS} h ago</span><span>now</span></p>
    </section>
  );
}
