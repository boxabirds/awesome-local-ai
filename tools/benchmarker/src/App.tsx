import { useState } from "react";
import { RUN_STATUSES, type Row, type RunStatus } from "../shared/types.ts";
import { Header } from "./components/Header.tsx";
import { StatusFilter } from "./components/StatusFilter.tsx";
import { StoryView } from "./components/StoryView.tsx";
import { MachinesTab } from "./components/MachinesTab.tsx";
import { SetupTab } from "./components/SetupTab.tsx";
import { StaleBanner } from "./components/StaleBanner.tsx";
import { MachineSection } from "./components/MachineSection.tsx";
import { scoreOf } from "./components/ScoreCell.tsx";
import { groupByMachine } from "../shared/grouping.ts";
import { useBenchState } from "./useBenchState.ts";

const SAVED_KEY = "benchmarker:v2"; // versioned: selections saved by older builds are ignored
const ALL = "all";
const HIDDEN_KEY = "benchmarker:hidden-statuses:v1";
const VIEW_KEY = "benchmarker:view:v1";
type View = "machine" | "story";
type Tab = "runs" | "machines" | "setup";
const TAB_KEY = "benchmarker:tab:v1";
const TABS: [Tab, string][] = [["runs", "Runs"], ["machines", "Machines"], ["setup", "Setup"]];
const loadTab = (): Tab => { try { const t = localStorage.getItem(TAB_KEY); return t === "machines" || t === "setup" ? t : "runs"; } catch { return "runs"; } };
const loadView = (): View => { try { return localStorage.getItem(VIEW_KEY) === "story" ? "story" : "machine"; } catch { return "machine"; } };
const HIDDEN_AT_FIRST: RunStatus[] = ["cancelled"];

function loadHidden(): Set<RunStatus> {
  try {
    const saved = localStorage.getItem(HIDDEN_KEY);
    return new Set(saved === null ? HIDDEN_AT_FIRST : (JSON.parse(saved) as RunStatus[]));
  } catch {
    return new Set(HIDDEN_AT_FIRST);
  }
}

function saveHidden(hidden: Set<RunStatus>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}

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

export function App() {
  const { data, error, age, stale, serverNow } = useBenchState();
  const [choice, setChoice] = useState<Partial<Selection>>(loadSaved);
  const [hidden, setHidden] = useState<Set<RunStatus>>(loadHidden);
  const [view, setView] = useState<View>(loadView);
  const [tab, setTab] = useState<Tab>(loadTab);
  const chooseTab = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ } };
  const chooseView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* not remembered */ } };

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
  const inFamily = inPack.filter((r) => family === ALL || r.family === family);
  const counts = RUN_STATUSES.map((st) => [st, inFamily.filter((r) => r.status === st).length] as [RunStatus, number]).filter(([, n]) => n > 0);
  const shown = inFamily.filter((r) => !hidden.has(r.status));
  const totals = new Set(shown.map((r) => scoreOf(r)?.[1].total).filter((t): t is number => t != null));
  const scoreTotal = totals.size === 1 ? [...totals][0] : null;
  const chooseHidden = (next: Set<RunStatus>) => {
    setHidden(next);
    saveHidden(next);
  };

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
      >
        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map(([t, name]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => chooseTab(t)}>{name}</button>)}
        </div>
        {tab !== "runs" ? null : <>
        <div className="view-switch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "machine"} className="chip" onClick={() => chooseView("machine")}>By machine</button>
          <button type="button" aria-pressed={view === "story"} className="chip" onClick={() => chooseView("story")}>By story</button>
        </div>
        <StatusFilter counts={counts} hidden={hidden} onChange={chooseHidden} />
        </>}
      </Header>
      <StaleBanner stale={stale} age={age} error={error} />
      <main>
        {tab === "machines" ? <MachinesTab state={data} /> : tab === "setup" ? <SetupTab /> : view === "story" ? <StoryView rows={shown} hidden={[...hidden]} /> : (
          <>
        {groupByMachine(shown, data.machines ?? [])
          // A machine with nothing to show under this filter is left out, unless it is idle: that is news.
          .filter((g) => g.rows.length > 0 || (g.info !== null && !g.info.running && g.info.queued === 0))
          .map((g) => (
          <MachineSection key={g.machine} group={g} state={data} serverNow={serverNow} scoreTotal={scoreTotal} />
        ))}
        {shown.length === 0 ? <p className="empty">No runs for this pack, version and status.</p> : null}
          </>
        )}
      </main>
    </div>
  );
}
