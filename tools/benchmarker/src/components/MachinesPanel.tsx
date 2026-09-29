import type { Machine } from "../../shared/types.ts";

/** The id of a run's table row, so the panel can link to it. */
export const rowAnchor = (stack: string, runId: string) => `run:${stack}:${runId}`;

/** One line per dbench node: what it is running now, or that it is idle. */
export function MachinesPanel({ machines }: { machines: Machine[] }) {
  if (machines.length === 0) return null;
  return (
    <section className="machines" aria-label="Machines">
      <ul>
        {machines.map((m) => (
          <li key={m.node} data-node={m.node}>
            <span className="machine-name">{m.node}</span>
            {m.running ? (
              <a className="s-running" href={`#${encodeURIComponent(rowAnchor(m.running.stack, m.running.runId))}`}>
                running {m.running.short} {m.running.runId}
                {m.running.story ? ` · story ${m.running.story}` : " · starting"}
                {m.running.agentMinutes ? ` · ${Math.round(m.running.agentMinutes)} agent-min` : ""}
              </a>
            ) : (
              <span className="idle">idle</span>
            )}
            <span className="small">{m.queued ? `${m.queued} queued` : "nothing queued"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
