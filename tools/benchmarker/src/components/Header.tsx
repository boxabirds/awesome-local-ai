import type { ReactNode } from "react";
import type { State } from "../../shared/types.ts";
import { ago } from "../format.ts";
import { useHeightVar } from "../useHeightVar.ts";

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

export function Header({ state, serverNow, packs, pack, families, family, currentFamily, onPack, onFamily, children }: Props) {
  const since = (t: number) => (t && serverNow !== null ? serverNow - t : null);
  const errors = [state.fetchError ? `git: ${state.fetchError}` : "", state.dbenchError ? `dbench: ${state.dbenchError}` : ""].filter(Boolean);
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
      <span className="meta" data-testid="meta">
        repo fetched {ago(since(state.fetchedAt))} · dbench {ago(since(state.dbenchAt))} · suite {state.suites[pack] || "?"}
      </span>
      {errors.length > 0 ? <span className="err">{errors.join(" · ")}</span> : null}
      {children}
    </header>
  );
}
