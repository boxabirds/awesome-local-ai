// Take a machine off the benchmarker's list, after asking. Its dbench service keeps running; it can be added back.
import { useState } from "react";
import { change } from "../../api.ts";
import { refreshAll, type OpResult } from "./machineApi.ts";

/** `listed`: the machine is in the list now. Once removed it isn't, and only what the removal said stays.
 * `onRemoved`: what to do once it is removed (a machine's own page leaves: its runs are filed under their host). */
export function RemoveMachine({ name, listed = true, onRemoved }: { name: string; listed?: boolean; onRemoved?: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const remove = async () => {
    const r = await change<OpResult>("DELETE", `/api/machines/${encodeURIComponent(name)}`);
    setNote(r.message); setAsking(false);
    if (r.ok && onRemoved) onRemoved();
    await refreshAll();
  };
  if (!listed && !note) return null;
  return (
    <span className="remove-machine">
      {!listed ? null : asking ? (
        <span className="confirm">Remove {name} from the list? (Its dbench service keeps running.)
          <button type="button" onClick={remove}>Remove</button><button type="button" autoFocus onClick={() => setAsking(false)}>Keep</button></span>
      ) : <button type="button" className="quiet" onClick={() => setAsking(true)}>Remove machine…</button>}
      {note ? <span className="small note" role="status"> {note}</span> : null}
    </span>
  );
}
