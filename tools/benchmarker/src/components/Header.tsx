import type { ReactNode } from "react";
import type { State } from "../../shared/types.ts";
import { ago } from "../format.ts";
import { useHeightVar } from "../useHeightVar.ts";
import { utc } from "./run/bits.tsx";

interface Props {
  state: State;
  serverNow: number | null;
  packs: string[];
  pack: string;
  families: string[];
  family: string;
  currentFamily: string;
  onPack(pack: string): void;
  onFamily(family: string): void;
  /** The status filter, on its own line. */
  children?: ReactNode;
}

/** How fresh the data is, and no more: "updated 30s ago", or, when it isn't being updated, since when. */
export function freshness(state: Pick<State, "updatedAt" | "updating">, serverNow: number | null): string {
  if (!state.updatedAt) return "not updated yet";
  if (!state.updating) return `not updated since ${utc(state.updatedAt)}`;
  return `updated ${ago(serverNow === null ? null : serverNow - state.updatedAt)}`;
}

export function Header({ state, serverNow, packs, pack, families, family, currentFamily, onPack, onFamily, children }: Props) {
  const bar = useHeightVar<HTMLElement>("--header-h");
  return (
    <header ref={bar}>
      <h1>Benchmarker</h1>
      <label>
        Pack{" "}
        <select value={pack} onChange={(e) => onPack(e.target.value)} aria-label="Pack">
          {packs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>
        Version{" "}
        <select value={family} onChange={(e) => onFamily(e.target.value)} aria-label="Version">
          {families.map((f) => (
            <option key={f} value={f}>{f === "all" ? "all versions" : f}{f === currentFamily ? " (current)" : ""}</option>
          ))}
        </select>
      </label>
      <span className="meta" data-testid="meta" data-updating={state.updating ? "true" : "false"}>
        {freshness(state, serverNow)} · suite {state.suites[pack] || "?"}
      </span>
      {children}
    </header>
  );
}
