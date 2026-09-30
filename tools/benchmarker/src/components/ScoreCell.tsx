import type { Row } from "../../shared/types.ts";
import { scoreOf } from "../../shared/stats.ts";

export { scoreOf };

interface Props { row: Row; building: boolean; web: string | null; branch: string }

/** One number: hidden flows passing. The total is in the column heading; the suite version in the tooltip. */
export function ScoreCell({ row, building, web, branch }: Props) {
  const found = scoreOf(row);
  if (!found) return <span className="wait">{building ? "—" : row.stages.score}</span>;
  const [version, s] = found;
  const link = web && row.dir ? `${web}/blob/${branch}/${row.dir}/rescore/${version}/per-story.md` : null;
  const title = `${s.passed} of ${s.total} hidden flows pass · suite ${version}${s.flaky ? ` · ${s.flaky} flaky` : ""} · per-story results`;
  const n = <strong className="score-n">{s.passed}</strong>;
  return link ? <a href={link} target="_blank" rel="noopener" data-tip={title}>{n}</a> : <span data-tip={title}>{n}</span>;
}
