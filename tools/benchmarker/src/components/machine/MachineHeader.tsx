// Who the machine is: its hardware, OS, dbench version and reachability, and what is installed on it (each
// installed combination a link to its page once it has a run).
import type { Row } from "../../../shared/types.ts";
import { overviewHref } from "../../../shared/routes.ts";
import { CombinationLink } from "../EntityLinks.tsx";
import { Missing, Term } from "../run/bits.tsx";
import { hardware, type MachineInfo } from "./machineApi.ts";
import { RemoveMachine } from "./RemoveMachine.tsx";

/** An installed combination: a link per pack it has runs in, else its id, saying why it has no page. */
function InstallLink({ stack, all }: { stack: string; all: Row[] }) {
  const packs = [...new Map(all.filter((r) => r.stack === stack).map((r) => [r.pack, r])).values()];
  if (!packs.length) return <span className="mono no-page" tabIndex={0} data-tip={`${stack}: no run of this combination yet, so it has no page.`}>{stack}</span>;
  return <>{packs.map((r, i) => (
    <span key={r.pack}>{i ? " · " : ""}<CombinationLink pack={r.pack} stack={stack} label={r.label} />{packs.length > 1 ? <span className="small"> ({r.pack})</span> : null}</span>
  ))}</>;
}

function Reachability({ info, listed }: { info: MachineInfo | undefined; listed: boolean }) {
  if (!listed) return <span className="small" data-reach="checking">checking…</span>;
  if (!info) return <span className="small" data-reach="unlisted" tabIndex={0} data-tip="The benchmarker's machine list doesn't have it: it is known from its runs' records only (a run from before dbench, or a machine removed from the list).">not in the machine list</span>;
  return info.ok
    ? <span data-reach="ok"><span className="ok-text">✓ reachable</span> <span className="small mono">{info.url}</span></span>
    : <span data-reach="unreachable"><span className="bad-text">✕ unreachable</span>{info.error ? <span className="small">: {info.error}</span> : null} <span className="small mono">{info.url}</span></span>;
}

export function MachineHeader({ machine, info, listed, runs, all }: { machine: string; info: MachineInfo | undefined; listed: boolean; runs: Row[]; all: Row[] }) {
  const node = info?.node;
  const host = runs.find((r) => r.host)?.host ?? "";
  const hw = node ? hardware({ ...node, os: undefined }) : "";
  const why = !listed ? "Waiting for the machine list." : !info ? "Not a dbench node in the list: nothing reports it." : !info.ok ? "Unreachable: dbench can't be asked." : "dbench didn't say.";
  const installs = node?.combinations ?? [];
  return (
    <div className="mp-header" data-section="header">
      <div className="mp-title">
        <div className="eyebrow">Machine</div>
        <h1>{machine}</h1>
        <RemoveMachine name={machine} listed={Boolean(info)} onRemoved={() => { location.hash = overviewHref(); }} />
      </div>
      <dl className="mp-facts">
        <div><dt><Term id="hardware" /></dt><dd data-fact="hardware">{hw || (host ? <span data-tip="From its runs' records: dbench hasn't described it.">{host}</span> : <Missing why={why} />)}</dd></div>
        <div><dt><Term id="os" /></dt><dd data-fact="os">{node?.os || <Missing why={why} />}</dd></div>
        <div><dt><Term id="dbenchVersion" /></dt><dd data-fact="dbench" className="mono">{node?.dbench_version || <Missing why={why} />}</dd></div>
        <div><dt><Term id="reachability" /></dt><dd data-fact="reach"><Reachability info={info} listed={listed} /></dd></div>
      </dl>
      <div className="mp-installs" data-fact="installs">
        <span className="label"><Term id="installs" /></span>
        {installs.length ? <ul>{installs.map((c) => <li key={c.install_id} data-install={c.install_id}><InstallLink stack={c.combination} all={all} /></li>)}</ul>
          : <span className="small">{node ? "Nothing installed yet: install a combination there first (Setup, step 5)." : <Missing why={why} />}</span>}
      </div>
    </div>
  );
}
