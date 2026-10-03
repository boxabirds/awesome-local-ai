// What the model's thinking was spent on, two combinations side by side. The classes are an unsupervised reading of the
// thinking text (benchmarks/docs/insights/thinking): a description of what the thinking looks like, not a judgement of
// it. The comparison uses only the stories both combinations ran, so the task's subject is the same on both sides.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { activityReport, activityStacks, type ActivityData } from "../../shared/activityView.ts";
import { combinationHref, type Route } from "../../shared/routes.ts";
import { GLOSSARY } from "../../shared/glossary.ts";
import { Breadcrumb } from "../components/EntityLinks.tsx";
import { Missing, Section, full } from "../components/run/bits.tsx";
import { useAddressParam } from "../components/story/useAddressParam.ts";
import "./run.css";
import "./activity.css";

const PERCENT = 100;
const RATIO_DIGITS = 2;
const fetcher = (u: string) => fetch(u).then((r) => r.json() as Promise<ActivityData>);
const label = (stack: string) => stack.split("/").slice(1).join("/");

function Picker({ id, name, stacks, value, onChange }: { id: string; name: string; stacks: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="act-pick" htmlFor={id}>
      <span className="small">{name}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {stacks.map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select>
    </label>
  );
}

export function ActivityPage({ route, params }: { route: Route; params?: Record<string, string> }) {
  const { data, isLoading } = useSWR("/api/conversations/activity", fetcher, { revalidateOnFocus: false });
  const [leftParam, setLeft] = useAddressParam(params, "a");
  const [rightParam, setRight] = useAddressParam(params, "b");
  const stacks = data ? activityStacks(data) : [];
  const left = leftParam && stacks.includes(leftParam) ? leftParam : stacks[0] ?? "";
  const right = rightParam && stacks.includes(rightParam) ? rightParam : stacks.find((s) => s !== left) ?? "";
  useEffect(() => { document.title = "Activity · Benchmarker"; }, []);
  const report = data && left && right ? activityReport(data, left, right) : null;
  return (
    <div className="page activity-page run-page" data-page="activity">
      <Breadcrumb route={route} />
      <Section term="thinkingActivity" id="activity">
        <p className="small act-note">{GLOSSARY.thinkingActivity.what}</p>
        {isLoading ? <p className="rp-empty small">Loading…</p> : stacks.length < 2 ? (
          <p className="rp-empty" data-empty="activity"><Missing why="No activity figures are available." /> Not available.</p>
        ) : (
          <>
            <div className="act-pickers">
              <Picker id="act-a" name="This combination" stacks={stacks} value={left} onChange={setLeft} />
              <Picker id="act-b" name="against" stacks={stacks} value={right} onChange={setRight} />
            </div>
            {!report ? (
              <p className="rp-empty small" data-empty="shared">These two have no story in common, so there is nothing to set against each other.</p>
            ) : (
              <>
                <p className="small" data-fact="basis">Over the {report.stories.length} {report.stories.length === 1 ? "story" : "stories"} both ran ({report.stories.join(", ")}), as the median of each one's runs.</p>
                <div className="table-scroll">
                  <table className="rp-table act-table" aria-label="Thinking by activity">
                    <thead>
                      <tr>
                        <th>Activity</th>
                        <th className="n">Times as much</th>
                        <th className="n" title={left}>{label(left)}</th>
                        <th className="n">share</th>
                        <th className="n" title={right}>{label(right)}</th>
                        <th className="n">share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.classes.map((c) => (
                        <tr key={c.id} data-class={c.id}>
                          <th scope="row"><span className="term" data-tip={c.definition}>{c.name}</span></th>
                          <td className="n act-ratio" data-ratio={c.ratio === null ? undefined : c.ratio.toFixed(RATIO_DIGITS)}>
                            {c.ratio === null ? <Missing why="Nothing was spent on this activity by the first combination, so there is no ratio." /> : `${c.ratio.toFixed(RATIO_DIGITS)}×`}
                          </td>
                          <td className="n">{full(Math.round(c.left))}</td>
                          <td className="n small">{report.total.left ? `${Math.round((c.left / report.total.left) * PERCENT)}%` : "—"}</td>
                          <td className="n">{full(Math.round(c.right))}</td>
                          <td className="n small">{report.total.right ? `${Math.round((c.right / report.total.right) * PERCENT)}%` : "—"}</td>
                        </tr>
                      ))}
                      <tr data-class="total" className="act-total">
                        <th scope="row">All thinking</th>
                        <td className="n act-ratio">{report.total.ratio === null ? <Missing why="Nothing to divide by." /> : `${report.total.ratio.toFixed(RATIO_DIGITS)}×`}</td>
                        <td className="n">{full(Math.round(report.total.left))}</td>
                        <td className="n small">100%</td>
                        <td className="n">{full(Math.round(report.total.right))}</td>
                        <td className="n small">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="small act-foot">
                  Characters of thinking in a story run. <a href={combinationHref("vidi", left)}>{label(left)}</a> and{" "}
                  <a href={combinationHref("vidi", right)}>{label(right)}</a>.
                </p>
              </>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
