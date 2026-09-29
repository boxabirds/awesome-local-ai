import type { Row } from "../../shared/types.ts";

interface Props { row: Row; building: boolean; web: string | null; branch: string }

export function ScoreCell({ row, building, web, branch }: Props) {
  const scores = Object.entries(row.scores);
  if (scores.length === 0) return <span className="wait">{building ? "—" : row.stages.score}</span>;
  return (
    <>
      {scores.map(([version, s]) => {
        const text = `${s.passed}/${s.total}`;
        const link = web && row.dir ? `${web}/blob/${branch}/${row.dir}/rescore/${version}/per-story.md` : null;
        return (
          <div key={version}>
            <span className="chip">{version}</span>{" "}
            {link ? <a href={link} target="_blank" rel="noopener">{text}</a> : text}
            {s.flaky > 0 ? <span className="small"> {s.flaky} flaky</span> : null}
          </div>
        );
      })}
    </>
  );
}
