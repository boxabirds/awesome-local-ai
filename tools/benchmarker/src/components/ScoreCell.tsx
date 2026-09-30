import type { Row } from "../../shared/types.ts";

interface Props { row: Row; building: boolean; web: string | null; branch: string }

/** The score of record: hidden flows passing out of all of them, from each re-score; the current suite's first. */
export function ScoreCell({ row, building, web, branch }: Props) {
  const scores = Object.entries(row.scores).toSorted(([a], [b]) => (a === row.suite ? -1 : b === row.suite ? 1 : b.localeCompare(a)));
  if (scores.length === 0) return <span className="wait">{building ? "—" : row.stages.score}</span>;
  return (
    <>
      {scores.map(([version, s]) => {
        const link = web && row.dir ? `${web}/blob/${branch}/${row.dir}/rescore/${version}/per-story.md` : null;
        const main = (
          <>
            <strong>{s.passed}</strong> of {s.total} flows pass
          </>
        );
        return (
          <div key={version} className="score">
            <div className="score-main">
              {link ? <a href={link} target="_blank" rel="noopener" title="per-story results">{main}</a> : main}
            </div>
            <div className="small">
              suite {version}
              {s.flaky > 0 ? ` · ${s.flaky} flaky` : ""}
            </div>
          </div>
        );
      })}
    </>
  );
}
