import { useState, type ReactNode } from "react";
import type { Row } from "../shared/types.ts";
import { RUN_FILTERS, visibleRuns, type RunFilter } from "../shared/stats.ts";
import { Header } from "./components/Header.tsx";
import { FilteredOut, RunFilterSwitch } from "./components/RunFilter.tsx";
import { SetupTab } from "./components/SetupTab.tsx";
import { Tooltip } from "./components/Tooltip.tsx";
import { StaleBanner } from "./components/StaleBanner.tsx";
import { useBenchState } from "./useBenchState.ts";
import { useRoute } from "./router.ts";
import { overviewHref, storyHref } from "../shared/routes.ts";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { MachinesIndex } from "./pages/MachinesIndex.tsx";
import { RunPage } from "./pages/RunPage.tsx";
import { StoryRunPage } from "./pages/StoryRunPage.tsx";
import { CombinationPage } from "./pages/CombinationPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { StoryPage } from "./pages/StoryPage.tsx";
import { MachinePage } from "./pages/MachinePage.tsx";

const SAVED_KEY = "benchmarker:v2"; // versioned: selections saved by older builds are ignored
const ALL = "all";
const FILTER_KEY = "benchmarker:run-filter:v1";
type Tab = "runs" | "machines" | "setup";
const TAB_KEY = "benchmarker:tab:v1";
const TABS: [Tab | "stories", string][] = [["runs", "Runs"], ["stories", "Stories"], ["machines", "Machines"], ["setup", "Setup"]];
const loadTab = (): Tab => { try { const t = localStorage.getItem(TAB_KEY); return t === "machines" || t === "setup" ? t : "runs"; } catch { return "runs"; } };
const FILTER_AT_FIRST: RunFilter = "all";

function loadFilter(): RunFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    return RUN_FILTERS.find((f) => f === saved) ?? FILTER_AT_FIRST;
  } catch {
    return FILTER_AT_FIRST;
  }
}

function saveFilter(filter: RunFilter) {
  try {
    localStorage.setItem(FILTER_KEY, filter);
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
  const route = useRoute();
  const [choice, setChoice] = useState<Partial<Selection>>(loadSaved);
  const [filter, setFilter] = useState<RunFilter>(loadFilter);
  const [tab, setTab] = useState<Tab>(loadTab);
  const chooseTab = (t: Tab) => {
    setTab(t);
    if (route.page !== "overview") location.hash = overviewHref();  // the tabs are the overview's
    try { localStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ }
  };

  if (!data) {
    return (
      <>
        <StaleBanner stale={Boolean(error)} age={age} />
        <p className="empty">{error ? "No data yet." : "Loading…"}</p>
      </>
    );
  }

  const pack = pickPack(data.rows, choice.pack);
  const inPack = data.rows.filter((r) => r.pack === pack);
  const families = [...new Set(inPack.map((r) => r.family).filter(Boolean))].toSorted().toReversed();
  const current = /^(.*?-v\d+)/.exec(data.suites[pack] ?? "")?.[1] ?? "";
  const family = pickFamily(families, current, choice.family);
  const inFamily = inPack.filter((r) => family === ALL || r.family === family);
  const chooseFilter = (next: RunFilter) => {
    setFilter(next);
    saveFilter(next);
  };
  const filteredOut = <FilteredOut onShowAll={() => chooseFilter("all")} />;

  const choose = (next: Selection) => {
    setChoice(next);
    save(next);
  };

  return (
    <div className={stale ? "stale" : undefined}>
      <Tooltip />
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
          {TABS.map(([t, name]) => t === "stories"
            // Stories are pages of their own: the tab opens the pack's first one, whose side list goes to the rest.
            ? <button key={t} type="button" role="tab" aria-selected={route.page === "story"} onClick={() => { location.hash = storyHref(pack, firstStory(inFamily)); }}>{name}</button>
            : <button key={t} type="button" role="tab" aria-selected={route.page === "overview" && tab === t} onClick={() => chooseTab(t as Tab)}>{name}</button>)}
        </div>
        <RunFilterSwitch filter={filter} onChange={chooseFilter} />
      </Header>
      <StaleBanner stale={stale} age={age} />
      <main>
        {route.page !== "overview" ? <EntityPage route={route} state={data} serverNow={serverNow} family={family} filter={filter} filteredOut={filteredOut} /> : <>
        {tab === "machines" ? <MachinesIndex state={data} serverNow={serverNow} />
          : tab === "setup" ? <SetupTab />
          : <OverviewPage state={data} serverNow={serverNow} rows={visibleRuns(inFamily, filter)} filteredOut={inFamily.length ? filteredOut : undefined} />}
        </>}
      </main>
    </div>
  );
}

/** The first story any of these runs has, for the Stories tab to open. */
const FIRST_STORY = 1;
function firstStory(runs: Row[]): string {
  const ids = runs.flatMap((r) => r.storiesWorking.squares.map((q) => Number(q.id))).filter(Number.isFinite);
  return String(ids.length ? Math.min(...ids) : FIRST_STORY);
}

/** A page of its own for one entity, found in the whole state (not only what the overview's filters show). */
type BenchState = NonNullable<ReturnType<typeof useBenchState>["data"]>;

/** The state as a page sees it: only runs it can be compared with, of the same pack and version family, and of
 * those only the ones the header's switch shows. A v1 run was built against another spec and scored by another
 * suite: its stories aren't the same stories. This is the one place the switch is applied to the entity pages. */
const comparable = (state: BenchState, pack: string, family: string, filter: RunFilter): BenchState =>
  ({ ...state, rows: visibleRuns(state.rows.filter((r) => r.pack === pack && r.family === family), filter) });

/** The newest version family among these runs ("vidi-v2" over "vidi-v1"). */
const newestFamily = (runs: Row[]) => runs.map((r) => r.family).toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? "";

/** A page whose content the switch hides entirely: the one line that says so, with the way out. */
const Hidden = ({ note }: { note: ReactNode }) => <div className="page" data-page="filteredOut">{note}</div>;

function EntityPage({ route, state, serverNow, family, filter, filteredOut }: { route: Exclude<ReturnType<typeof useRoute>, { page: "overview" }>; state: BenchState; serverNow: number | null; family: string; filter: RunFilter; filteredOut: ReactNode }) {
  switch (route.page) {
    case "combination": {
      const all = state.rows.filter((r) => r.pack === route.pack && r.stack === route.stack);
      if (!all.length) return <NotFound what={`combination ${route.stack}`} />;
      // The family chosen in the header when this combination has runs in it; else (or with "all") its newest.
      const fam = family !== ALL && all.some((r) => r.family === family) ? family : newestFamily(all);
      const scoped = comparable(state, route.pack, fam, filter);
      const runs = scoped.rows.filter((r) => r.stack === route.stack);
      if (!runs.length) return <Hidden note={filteredOut} />;
      return <CombinationPage stack={route.stack} runs={runs} state={scoped} serverNow={serverNow} params={route.params} />;
    }
    case "run":
    case "storyRun": {
      const run = state.rows.find((r) => r.pack === route.pack && r.stack === route.stack && r.runId === route.runId);
      if (!run) return <NotFound what={`run ${route.runId} of ${route.stack}`} />;
      const scoped = comparable(state, run.pack, run.family, filter);
      if (!scoped.rows.includes(run)) return <Hidden note={filteredOut} />;
      if (route.page === "run") return <RunPage run={run} state={scoped} serverNow={serverNow} params={route.params} />;
      const story = run.stories.find((s) => s.id === route.story) ?? null;
      return <StoryRunPage run={run} story={story} storyId={route.story} state={scoped} serverNow={serverNow} params={route.params} />;
    }
    case "story": {
      const all = state.rows.filter((r) => r.pack === route.pack);
      if (!all.length) return <NotFound what={`pack ${route.pack}`} />;
      const fam = family !== ALL && all.some((r) => r.family === family) ? family : newestFamily(all);
      const scoped = comparable(state, route.pack, fam, filter);
      if (!scoped.rows.length) return <Hidden note={filteredOut} />;
      return <StoryPage pack={route.pack} story={route.story} runs={scoped.rows} state={scoped} serverNow={serverNow} params={route.params} />;
    }
    case "machine": {
      // A machine runs every pack and version: its page shows all of them, each labelled.
      const runs = state.rows.filter((r) => r.machine === route.machine);
      const known = runs.length > 0 || (state.machines ?? []).some((m) => m.node === route.machine);
      // The history follows the switch; what the machine is doing now (from the whole state) never does.
      const shown = visibleRuns(runs, filter);
      return known ? <MachinePage machine={route.machine} runs={runs} history={shown} filteredOut={filteredOut} state={state} serverNow={serverNow} /> : <NotFound what={`machine ${route.machine}`} />;
    }
    case "notFound":
      return <NotFound what={`page at "${route.path}"`} />;
  }
}
