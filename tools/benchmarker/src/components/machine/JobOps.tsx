// What can be done to one job: stop a running one (after asking), remove a queued one, restart one that failed,
// stopped or was cancelled. Shared by the machines list and each machine's page.
import { useEffect, useRef, useState } from "react";
import { change } from "../../api.ts";
import { refreshAll, type OpResult } from "./machineApi.ts";

/** Jobs that ended early can be restarted: the run resumes at its first unfinished story. */
const RESTARTABLE = ["failed", "cancelled", "stopped"];

const jobUrl = (node: string, jobId: string) => `/api/jobs/${encodeURIComponent(node)}/${encodeURIComponent(jobId)}`;

export function JobOps({ node, jobId, status }: { node: string; jobId: string; status: string }) {
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState("");
  const keep = useRef<HTMLButtonElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  // Asking first: the safe answer takes the focus, so Enter by habit keeps the job running.
  useEffect(() => { if (confirm) keep.current?.focus(); }, [confirm]);
  const act = async (what: "cancel" | "restart") => {
    const r = await change<OpResult>("POST", `${jobUrl(node, jobId)}/${what}`);
    setMsg(r.message); setConfirm(false); await refreshAll();
  };
  const cancelConfirm = () => { setConfirm(false); requestAnimationFrame(() => stop.current?.focus()); };
  return (
    <>
      {status === "running" && !confirm ? <button ref={stop} type="button" onClick={() => setConfirm(true)}>Stop</button> : null}
      {status === "running" && confirm ? (
        <span className="confirm" role="alertdialog" aria-label={`Stop ${jobId}?`} onKeyDown={(e) => { if (e.key === "Escape") cancelConfirm(); }}>
          Stop {jobId}? It throws away the story in progress; Restart resumes the run from that story.
          <button type="button" className="danger" onClick={() => act("cancel")}>Yes, stop it</button>
          <button ref={keep} type="button" onClick={cancelConfirm}>Keep running</button></span>
      ) : null}
      {status === "queued" ? <button type="button" onClick={() => act("cancel")}>Remove</button> : null}
      {RESTARTABLE.includes(status) ? <button type="button" onClick={() => act("restart")}>Restart</button> : null}
      {msg ? <div className="small note" role="status">{msg}</div> : null}
    </>
  );
}
