import type { Row } from "../../shared/types.ts";
import { ordinal } from "../format.ts";

/** One word for where the run is; below it, its place in the queue, a failure's reason, or when it ended. */
export function StatusCell({ row }: { row: Row }) {
  const queue = row.status === "queued" ? row.live?.queue : null;
  const ended = row.status === "finished" || row.status === "stopped" || row.status === "failed";
  const note = queue
    ? `${ordinal(queue.position)} on ${row.node}`
    : row.statusNote || (ended && row.stateAt ? row.stateAt.slice(0, 16).replace("T", " ") + " UTC" : "");
  return (
    <>
      <div className={`status-word s-${row.status}`}>{row.status}</div>
      {note ? <div className="small" data-tip={note}>{note}</div> : null}
    </>
  );
}
