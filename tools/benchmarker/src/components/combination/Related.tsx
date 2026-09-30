// The combination's machines (plain names: machine pages don't exist yet) and the other combinations of its model.
import type { Row } from "../../../shared/types.ts";
import { modelOf } from "../../../shared/combinationView.ts";
import { summarise } from "../../../shared/stats.ts";
import { CombinationLink } from "../EntityLinks.tsx";
import { Term } from "./Term.tsx";
import { fmtCount, SpreadText } from "./Spread.tsx";

/** Each machine the combination's runs ran on, with its hardware as the records name it. */
export function machinesOf(runs: Row[]): { machine: string; host: string }[] {
  const by = new Map<string, string>();
  for (const r of runs) if (!by.has(r.machine) || (!by.get(r.machine) && r.host)) by.set(r.machine, r.host && r.host !== r.machine ? r.host : "");
  return [...by.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([machine, host]) => ({ machine, host }));
}

export function Related({ stack, runs, all }: { stack: string; runs: Row[]; all: Row[] }) {
  const pack = runs[0].pack;
  const model = modelOf(stack);
  const others = new Map<string, Row[]>();
  for (const r of all) if (r.pack === pack && r.stack !== stack && modelOf(r.stack) === model) others.set(r.stack, [...(others.get(r.stack) ?? []), r]);
  return (
    <div className="related">
      <div>
        <h3><Term id="comboMachines" /></h3>
        <ul className="related-machines">{machinesOf(runs).map((m) => <li key={m.machine}><b>{m.machine}</b>{m.host ? <span className="small"> {m.host}</span> : null}</li>)}</ul>
      </div>
      <div>
        <h3><Term id="relatedCombinations" /></h3>
        {others.size === 0 ? <p className="empty-note" data-related="none">No other combination of {model} in {pack}.</p> : (
          <ul className="related-combos">
            {[...others.entries()].map(([s, rs]) => {
              const c = summarise(s, rs);
              return (
                <li key={s} data-stack={s}>
                  <CombinationLink pack={pack} stack={s} label={rs[0].label} />{" "}
                  <span className="small">{c.machines.join(", ")} · {c.score ? <>score <SpreadText s={c.score} fmt={fmtCount} showN /></> : `not ranked: ${c.unranked}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
