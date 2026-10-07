import type { ReactNode } from "react";
import type { State } from "../../shared/types.ts";
import { ago } from "../format.ts";
import { overviewHref } from "../../shared/routes.ts";
import { useHeightVar } from "../useHeightVar.ts";
import { SearchBox } from "./SearchBox.tsx";
import { utc } from "./run/bits.tsx";

interface Props {
  state: State;
  serverNow: number | null;
  /** The pack the freshness line reports the suite of; the choices themselves are `scope`, where there are any. */
  pack: string;
  /** The pack and version choices, when this page's figures are all of one pack and version. The dashboard keeps
   * them in the ranking band's own heading instead, because that band is all they scope, and passes nothing here. */
  scope?: ReactNode;
  /** The tabs and the runs switch. */
  children?: ReactNode;
}

/** How fresh the data is, and no more: "updated 30s ago", or, when it isn't being updated, since when. */
export function freshness(state: Pick<State, "updatedAt" | "updating">, serverNow: number | null): string {
  if (!state.updatedAt) return "not updated yet";
  if (!state.updating) return `not updated since ${utc(state.updatedAt)}`;
  return `updated ${ago(serverNow === null ? null : serverNow - state.updatedAt)}`;
}

export function Header({ state, serverNow, pack, scope, children }: Props) {
  const bar = useHeightVar<HTMLElement>("--header-h");
  return (
    <header ref={bar}>
      <h1><a className="home-link" href={overviewHref()}>Benchmarker</a></h1>
      {scope}
      {/* The figures are only as current as the feed: when it has stopped refreshing, the line says so and is marked,
          which is a fact about the data and not a fault to explain. */}
      <span className="meta" data-testid="meta" data-updating={state.updating ? "true" : "false"} data-stopped={state.updating ? undefined : "true"}>
        {freshness(state, serverNow)} · suite {state.suites[pack] || "?"}
      </span>
      <SearchBox state={state} />
      {children}
    </header>
  );
}
