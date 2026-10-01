// Add a machine to the list: its name, its dbench address, and its token (read over SSH, or pasted).
import { useState } from "react";
import { change } from "../../api.ts";
import { refreshAll, type OpResult } from "./machineApi.ts";

export function AddMachine() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [asked, setAsked] = useState<OpResult | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await change<OpResult>("POST", "/api/machines", { name, url: url || undefined, token: token || undefined });
    if (r.ok) { setName(""); setUrl(""); setToken(""); setAsked({ ok: true, message: `${name} added${token ? "" : " (its token read over SSH)"}` }); await refreshAll(); }
    else setAsked(r);
  };
  const needToken = asked?.needToken === true;
  return (
    <form className="add-machine" onSubmit={submit} aria-label="Add a machine">
      <h3>Add a machine</h3>
      <label>Machine name <input aria-label="Machine name" value={name} required placeholder="its name on your network, e.g. node-a" onChange={(e) => { setName(e.target.value); setAsked(null); setToken(""); }} /></label>
      <label>dbench address <input value={url} placeholder={name ? `http://${name}:7717` : "http://<name>:7717"} onChange={(e) => setUrl(e.target.value)} /></label>
      {needToken ? <label>Token <input aria-label="Token" value={token} autoComplete="off" onChange={(e) => setToken(e.target.value)} /></label> : null}
      <button type="submit" disabled={!name}>Add</button>
      {asked ? <div className={asked.ok ? "small note" : "err"}>{asked.message}</div> : null}
      <div className="small">The token is read over SSH when it can be, else asked for. It is saved in <code>~/.config/dbench/nodes.toml</code> on this Mac (only you can read it) and never shown again.</div>
    </form>
  );
}
