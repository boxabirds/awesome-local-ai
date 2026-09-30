import { useState } from "react";
import useSWR, { mutate } from "swr";
import type { Row, State } from "../../shared/types.ts";
import { change } from "../api.ts";

const POLL_MS = 10_000;
const GIB = 1024 ** 3;
const DEFAULT_PACK = "benchmarks/vidi";
const CLIENTS = ["pi", "claude", "opencode"];
const RECENT_ENDED = 5;  // ended jobs shown before "older"
const ORDER: Record<string, number> = { running: 0, queued: 1 };

interface Combination { install_id: string; combination: string; backend?: string }
interface NodeInfo {
  hostname?: string; os?: string; cpu_brand?: string; cpus?: number; total_ram_bytes?: number;
  gpus?: { name: string; memory_mib?: number; unified?: boolean }[]; dbench_version?: string;
  current_job?: string | null; combinations?: Combination[];
}
interface Machine { name: string; url: string; ok: boolean; error?: string; node?: NodeInfo }
interface Result { ok: boolean; message: string; needToken?: boolean; ids?: string[] }

const fetchJson = async (url: string) => (await fetch(url, { cache: "no-store" })).json();
const refreshAll = () => Promise.all([mutate("/api/machines"), mutate("/api/state")]);

/** The machines (dbench nodes): each with its hardware, installs and jobs, a form to queue a run, and adding one. */
export function MachinesTab({ state }: { state: State }) {
  const { data: machines } = useSWR<Machine[]>("/api/machines", fetchJson, { refreshInterval: POLL_MS });
  return (
    <div className="machines-tab">
      {(machines ?? []).map((m) => <MachineCard key={m.name} m={m} rows={state.rows.filter((r) => r.node === m.name && r.live)} />)}
      {machines && machines.length === 0 ? <p className="empty">No machines yet. Add one below; Setup says how to prepare it.</p> : null}
      <AddMachine />
    </div>
  );
}

function hardware(n: NodeInfo): string {
  const gpus = (n.gpus ?? []).map((g) => g.unified ? `${g.name} (unified memory)` : `${g.name}${g.memory_mib ? ` ${Math.round(g.memory_mib / 1024)} GB` : ""}`);
  return [n.cpu_brand, n.cpus ? `${n.cpus} cores` : "", n.total_ram_bytes ? `${Math.round(n.total_ram_bytes / GIB)} GB RAM` : "", ...gpus, n.os].filter(Boolean).join(" · ");
}

function MachineCard({ m, rows }: { m: Machine; rows: Row[] }) {
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");
  const remove = async () => { const r = await change<Result>("DELETE", `/api/machines/${encodeURIComponent(m.name)}`); setNote(r.message); await refreshAll(); };
  const [older, setOlder] = useState(false);
  // Running first, then the queue in its order, then ended jobs, latest first.
  const jobs = rows.toSorted((a, b) =>
    (ORDER[a.live!.status] ?? 2) - (ORDER[b.live!.status] ?? 2)
    || (a.live!.queue?.position ?? 0) - (b.live!.queue?.position ?? 0)
    || (b.stateAt || "").localeCompare(a.stateAt || ""));
  const active = jobs.filter((r) => ORDER[r.live!.status] !== undefined), ended = jobs.filter((r) => ORDER[r.live!.status] === undefined);
  const shownJobs = [...active, ...(older ? ended : ended.slice(0, RECENT_ENDED))];
  const current = rows.find((r) => r.live!.status === "running")?.stack;
  return (
    <section className="machine-card" data-machine-card={m.name}>
      <h2>
        <span className="machine-name">{m.name}</span>
        <span className={m.ok ? "small" : "err"}>{m.ok ? hardware(m.node ?? {}) : `unreachable: ${m.error ?? ""}`}</span>
        <span className="small">{m.url}{m.node?.dbench_version ? ` · dbench ${m.node.dbench_version}` : ""}</span>
        {removing ? (
          <span className="confirm">Remove {m.name} from the list? (Its dbench service keeps running.)
            <button type="button" onClick={remove}>Remove</button><button type="button" onClick={() => setRemoving(false)}>Keep</button></span>
        ) : <button type="button" className="quiet" onClick={() => setRemoving(true)}>Remove machine…</button>}
      </h2>
      {note ? <div className="small note">{note}</div> : null}
      <div className="machine-body">
        <div>
          <h3>Jobs</h3>
          {jobs.length === 0 ? <div className="small">None queued or running.</div> : shownJobs.map((r) => <JobLine key={r.live!.jobId} node={m.name} row={r} />)}
          {ended.length > RECENT_ENDED ? <button type="button" className="quiet" onClick={() => setOlder(!older)}>{older ? "Fewer" : `${ended.length - RECENT_ENDED} older jobs`}</button> : null}
        </div>
        <QueueForm node={m.name} combos={m.node?.combinations ?? []} current={current} />
      </div>
    </section>
  );
}

function JobLine({ node, row }: { node: string; row: Row }) {
  const live = row.live!;
  const [confirm, setConfirm] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const act = async (what: "cancel" | "restart") => {
    const r = await change<Result>("POST", `/api/jobs/${encodeURIComponent(node)}/${encodeURIComponent(live.jobId)}/${what}`);
    setMsg(r.message); setConfirm(false); await refreshAll();
  };
  const showLog = async () => setLog(log === null ? await (await fetch(`/api/jobs/${encodeURIComponent(node)}/${encodeURIComponent(live.jobId)}/log`)).text() : null);
  const status = live.status;
  return (
    <div className="job-line" data-job={live.jobId}>
      <span className="mono">{live.jobId}</span>
      <span className="small">{row.label} {row.runId}</span>
      <span className={`status-word s-${row.status}`}>{status}{live.queue && status === "queued" ? ` · ${live.queue.position}` : ""}</span>
      {status === "running" && !confirm ? <button type="button" onClick={() => setConfirm(true)}>Stop</button> : null}
      {status === "running" && confirm ? (
        <span className="confirm">Stop {live.jobId}? It throws away the story in progress; Restart resumes the run from that story.
          <button type="button" className="danger" onClick={() => act("cancel")}>Yes, stop it</button>
          <button type="button" onClick={() => setConfirm(false)}>Keep running</button></span>
      ) : null}
      {status === "queued" ? <button type="button" onClick={() => act("cancel")}>Remove</button> : null}
      {["failed", "cancelled", "stopped", "done"].includes(status) && status !== "done" ? <button type="button" onClick={() => act("restart")}>Restart</button> : null}
      <button type="button" className="quiet" onClick={showLog}>{log === null ? "Log" : "Hide log"}</button>
      {msg ? <div className="small note">{msg}</div> : null}
      {log !== null ? <pre className="log-view">{log}</pre> : null}
    </div>
  );
}

function QueueForm({ node, combos, current }: { node: string; combos: Combination[]; current?: string }) {
  // Starts on the combination the machine is running now, else the first installed.
  const [picked, setInstall] = useState<string | null>(null);
  const installId = picked ?? combos.find((c) => c.combination === current)?.install_id ?? combos[0]?.install_id ?? "";
  const combo = combos.find((c) => c.install_id === installId);
  const [pack, setPack] = useState(DEFAULT_PACK);
  const [runId, setRunId] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [client, setClient] = useState<string | null>(null);
  const [msg, setMsg] = useState<Result | null>(null);
  const chosenClient = client ?? (combo?.backend === "anthropic" ? "claude" : "pi");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await change<Result>("POST", "/api/jobs", { node, installId, pack, runId, repeat, client: chosenClient });
    setMsg(r); if (r.ok) { setRunId(""); await refreshAll(); }
  };
  if (combos.length === 0) return <div className="queue-form small">Nothing installed on {node} yet: install a combination there first (Setup, step 5).</div>;
  return (
    <form className="queue-form" onSubmit={submit} aria-label={`Queue a run on ${node}`}>
      <h3>Queue a run</h3>
      <label>Combination <select aria-label="Combination" value={installId} onChange={(e) => setInstall(e.target.value)}>
        {combos.map((c) => <option key={c.install_id} value={c.install_id}>{c.combination}</option>)}</select></label>
      <label>Pack <input value={pack} onChange={(e) => setPack(e.target.value)} /></label>
      <label>Run id <input aria-label="Run id" value={runId} required placeholder="e.g. v2-r4" onChange={(e) => setRunId(e.target.value)} /></label>
      <label>Runs <input type="number" min={1} max={9} value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} /></label>
      <label>Client <select value={chosenClient} onChange={(e) => setClient(e.target.value)}>{CLIENTS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button type="submit" disabled={!runId || !installId}>Queue</button>
      {msg ? <div className={msg.ok ? "small note" : "err"}>{msg.message}</div> : null}
    </form>
  );
}

function AddMachine() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [asked, setAsked] = useState<Result | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await change<Result>("POST", "/api/machines", { name, url: url || undefined, token: token || undefined });
    if (r.ok) { setName(""); setUrl(""); setToken(""); setAsked({ ok: true, message: `${name} added${token ? "" : " (its token read over SSH)"}` }); await refreshAll(); }
    else setAsked(r);
  };
  const needToken = asked?.needToken === true;
  return (
    <form className="add-machine" onSubmit={submit} aria-label="Add a machine">
      <h3>Add a machine</h3>
      <label>Machine name <input aria-label="Machine name" value={name} required placeholder="its Tailscale name, e.g. gruntus" onChange={(e) => { setName(e.target.value); setAsked(null); setToken(""); }} /></label>
      <label>dbench address <input value={url} placeholder={name ? `http://${name}:7717` : "http://<name>:7717"} onChange={(e) => setUrl(e.target.value)} /></label>
      {needToken ? <label>Token <input aria-label="Token" value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} /></label> : null}
      <button type="submit" disabled={!name}>Add</button>
      {asked ? <div className={asked.ok ? "small note" : "err"}>{asked.message}</div> : null}
      <div className="small">The benchmarker first tries to read the machine's token over SSH; if it can't, it asks you to paste it.
        The token is saved in <code>~/.config/dbench/nodes.toml</code> on this Mac (only you can read it) and never shown again.</div>
    </form>
  );
}
