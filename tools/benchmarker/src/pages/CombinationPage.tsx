// One combination: how good and how costly it is, how consistent, and why its runs differ (plan section 4.2).
// Numbers of record are over its finished runs with a score of record only; the matrix shows every run.
import type { Row, State } from "../../shared/types.ts";
import { NOT_COUNTED_ORDER, summarise } from "../../shared/stats.ts";
import { buildMatrix, DEFAULT_METRIC, METRICS, type Metric } from "../../shared/combinationView.ts";
import { qualityClass } from "../format.ts";
import { Breadcrumb, MachineLink, RunLink } from "../components/EntityLinks.tsx";
import { Term, termTip } from "../components/combination/Term.tsx";
import { fmtCount, fmtHours, fmtTokens, SpreadText } from "../components/combination/Spread.tsx";
import { metricLabel, MetricSwitch, RunMatrix } from "../components/combination/RunMatrix.tsx";
import { RunTimeBars } from "../components/combination/RunTimeBars.tsx";
import { MechanismTally } from "../components/combination/MechanismTally.tsx";
import { machinesOf, Related } from "../components/combination/Related.tsx";
import type { Spread } from "../../shared/stats.ts";
import type { TermId } from "../../shared/glossary.ts";
import { useAddressParam } from "../components/story/useAddressParam.ts";
import "./combination.css";

const PERCENT = 100;

function Kpi({ term, s, fmt }: { term: TermId; s: Spread | null; fmt: (n: number) => string }) {
  return (
    <div className="kpi" data-kpi={term}>
      <dt><Term id={term} /></dt>
      <dd>{s ? <SpreadText s={s} fmt={fmt} big="num-l" /> : <span className="missing" tabIndex={0} data-tip="No finished run with a score of record recorded this.">—</span>}</dd>
    </div>
  );
}

/** The metric an address names (?metric=calls); the default for none or one that isn't a metric. */
const metricOf = (m: string | undefined): Metric => (METRICS as string[]).includes(m ?? "") ? (m as Metric) : DEFAULT_METRIC;

export function CombinationPage({ stack, runs, state, params }: { stack: string; runs: Row[]; state: State; serverNow: number | null; params?: Record<string, string> }) {
  const [metricParam, setMetricParam] = useAddressParam(params, "metric");
  const metric = metricOf(metricParam);
  // The default is left out of the address, so the plain address and "minutes" are one page.
  const setMetric = (m: Metric) => setMetricParam(m === DEFAULT_METRIC ? undefined : m);
  const c = summarise(stack, runs);
  const matrix = buildMatrix(runs, metric);
  const finished = c.byStatus.finished ?? 0;
  const counts = [
    finished ? `${finished} finished (${c.ofRecord.length} of record${c.notCounted.unscored ? `, ${c.notCounted.unscored} unscored` : ""})` : "",
    ...NOT_COUNTED_ORDER.filter((s) => s !== "unscored" && s !== "invalid" && c.notCounted[s]).map((s) => `${c.notCounted[s]} ${s}`),
  ].filter(Boolean);
  return (
    <div className="page combination-page" data-page="combination" data-stack={stack}>
      <Breadcrumb trail={[{ label: c.label }]} />
      <header className="combo-page-head">
        <div className="combo-title">
          <h1>{c.label}</h1>
          <code className="combo-id" data-tip={termTip("combination")}>{stack}</code>
          <p className="combo-on">on {machinesOf(runs).map((m, i) => <span key={m.machine}>{i ? ", " : ""}<b><MachineLink machine={m.machine} host={m.host} /></b>{m.host ? <span className="small"> ({m.host})</span> : null}</span>)} · {c.pack} · suite {runs[0].suite}</p>
        </div>
        <dl className="headline">
          <div className="kpi primary" data-kpi="score">
            <dt><Term id="scoreSummary">Score of record</Term></dt>
            <dd>{c.score ? <>
              <SpreadText s={c.score} fmt={fmtCount} big={`num-xl ${qualityClass(c.score.total ? c.score.median / c.score.total : null)}`} showN />
              <span className="small">{c.score.total ? ` / ${c.score.total}` : ""} · <Term id="pooledPassRate">pooled</Term> {Math.round(c.score.pooled * PERCENT)}%</span>
            </> : <span className="unranked" data-tip={termTip("unranked")}>not ranked: {c.unranked}</span>}</dd>
          </div>
          <Kpi term="hoursPerStory" s={c.hoursPerStory} fmt={fmtHours} />
          <Kpi term="outPerStory" s={c.outPerStory} fmt={fmtTokens} />
          <Kpi term="callsPerStory" s={c.callsPerStory} fmt={fmtCount} />
        </dl>
        <p className="run-counts" data-counts><Term id="runsByStatus" />: {counts.join(" · ")}
          {c.invalid.length ? <span data-standing="invalid"> · {c.invalid.length} <Term id="invalidRun">invalid</Term>, in no figure: {c.invalid.map((r, i) => (
            <span key={r.runId}>{i ? ", " : ""}<RunLink pack={r.pack} stack={r.stack} runId={r.runId} invalid={r.invalid} /></span>))}</span> : null}</p>
      </header>

      <section className="combo-section" data-section="matrix">
        <h2><Term id="matrix" /><MetricSwitch metric={metric} onChange={setMetric} /></h2>
        <RunMatrix runs={runs} metric={metric} matrix={matrix} />
      </section>

      <div className="combo-below">
        <section className="combo-section" data-section="time">
          <h2><Term id="runTimeSplit" /></h2>
          <RunTimeBars runs={runs} />
        </section>
        <section className="combo-section" data-section="tally">
          <h2><Term id="mechanismTally" /><span className="small">on {metricLabel(metric)}</span></h2>
          <MechanismTally matrix={matrix} metricLabel={metricLabel(metric)} />
        </section>
      </div>

      <section className="combo-section" data-section="related">
        <h2><Term id="related" /></h2>
        <Related stack={stack} runs={runs} all={state.rows} />
      </section>
    </div>
  );
}
