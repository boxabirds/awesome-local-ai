// Queue a run on a machine: one of its installed combinations, a pack, a run id, how many, and the client.
import { useState } from "react";
import { change } from "../../api.ts";
import { refreshAll, type Install, type OpResult } from "./machineApi.ts";

const DEFAULT_PACK = "benchmarks/vidi";
const CLIENTS = ["pi", "claude", "opencode"];
const MAX_REPEAT = 9;

export function QueueForm({ node, combos, current }: { node: string; combos: Install[]; current?: string }) {
  // Starts on the combination the machine is running now, else the first installed.
  const [picked, setInstall] = useState<string | null>(null);
  const installId = picked ?? combos.find((c) => c.combination === current)?.install_id ?? combos[0]?.install_id ?? "";
  const combo = combos.find((c) => c.install_id === installId);
  const [pack, setPack] = useState(DEFAULT_PACK);
  const [runId, setRunId] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [client, setClient] = useState<string | null>(null);
  const [msg, setMsg] = useState<OpResult | null>(null);
  const chosenClient = client ?? (combo?.backend === "anthropic" ? "claude" : "pi");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await change<OpResult>("POST", "/api/jobs", { node, installId, pack, runId, repeat, client: chosenClient });
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
      <label>Runs <input type="number" min={1} max={MAX_REPEAT} value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} /></label>
      <label>Client <select value={chosenClient} onChange={(e) => setClient(e.target.value)}>{CLIENTS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <button type="submit" disabled={!runId || !installId}>Queue</button>
      {msg ? <div className={msg.ok ? "small note" : "err"} role="status">{msg.message}</div> : null}
    </form>
  );
}
