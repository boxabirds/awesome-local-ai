import { useState } from "react";
import type { Row } from "../shared/types.ts";
import { Header } from "./components/Header.tsx";
import { StaleBanner } from "./components/StaleBanner.tsx";
import { StackSection } from "./components/StackSection.tsx";
import { useBenchState } from "./useBenchState.ts";

const SAVED_KEY = "benchmarker:v2"; // versioned: selections saved by older builds are ignored
const ALL = "all";

interface Selection { pack: string; family: string }

function loadSaved(): Partial<Selection> {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Partial<Selection>;
  } catch {
    return {};
  }
}

function save(sel: Selection) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(sel));
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}

const isLive = (r: Row) => r.live?.status === "running" || r.live?.status === "queued";

/** The pack to show: the chosen one if it exists, else the one with live jobs, else the one with most runs. */
function pickPack(rows: Row[], wanted: string | undefined): string {
  const packs = [...new Set(rows.map((r) => r.pack))];
  if (wanted && packs.includes(wanted)) return wanted;
  const score = (p: string) => [rows.filter((r) => r.pack === p && isLive(r)).length, rows.filter((r) => r.pack === p).length];
  return packs.toSorted((a, b) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1])[0] ?? "";
}

/** The version family to show: the chosen one if it has runs, else the pack's current one. */
function pickFamily(families: string[], current: string, wanted: string | undefined): string {
  if (wanted && (wanted === ALL || families.includes(wanted))) return wanted;
  return families.includes(current) ? current : families[0] ?? ALL;
}

function groupByStack(rows: Row[]): [string, Row[]][] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.stack, [...(groups.get(r.stack) ?? []), r]);
  const rank = (rs: Row[]) => Math.min(...rs.map((r) => (r.live?.status === "running" ? 0 : r.live?.status === "queued" ? 1 : 2)));
  return [...groups.entries()]
    .map(([stack, rs]) => [stack, rs.toSorted((a, b) => a.runId.localeCompare(b.runId, undefined, { numeric: true }))] as [string, Row[]])
    .toSorted((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));
}

export function App() {
  const { data, error, age, stale, serverNow } = useBenchState();
  const [choice, setChoice] = useState<Partial<Selection>>(loadSaved);

  if (!data) {
    return (
      <>
        <StaleBanner stale={Boolean(error)} age={age} error={error} />
        <p className="empty">{error ? "Can't reach the benchmarker server." : "Loading…"}</p>
      </>
    );
  }

  const pack = pickPack(data.rows, choice.pack);
  const inPack = data.rows.filter((r) => r.pack === pack);
  const families = [...new Set(inPack.map((r) => r.family).filter(Boolean))].toSorted().toReversed();
  const current = /^(.*?-v\d+)/.exec(data.suites[pack] ?? "")?.[1] ?? "";
  const family = pickFamily(families, current, choice.family);
  const shown = inPack.filter((r) => family === ALL || r.family === family);

  const choose = (next: Selection) => {
    setChoice(next);
    save(next);
  };

  return (
    <div className={stale ? "stale" : undefined}>
      <Header
        state={data}
        serverNow={serverNow}
        packs={[...new Set(data.rows.map((r) => r.pack))].toSorted()}
        pack={pack}
        families={[...families, ALL]}
        family={family}
        currentFamily={current}
        onPack={(p) => choose({ pack: p, family: "" })}
        onFamily={(f) => choose({ pack, family: f })}
      />
      <StaleBanner stale={stale} age={age} error={error} />
      <main>
        {shown.length === 0 ? (
          <p className="empty">No runs for this pack and version.</p>
        ) : (
          groupByStack(shown).map(([stack, rows]) => <StackSection key={stack} stack={stack} rows={rows} state={data} serverNow={serverNow} />)
        )}
      </main>
    </div>
  );
}
