import type { Row, Score } from "../../shared/types.ts";

interface Props { row: Row; building: boolean; web: string | null; branch: string }

/** The score of record for a row: the re-score under its current suite, else the latest re-score. */
export function scoreOf(row: Row): [string, Score] | null {
  const all = Object.entries(row.scores);
  return all.find(([v]) => v === row.suite) ?? all.toSorted(([a], [b]) => b.localeCompare(a))[0] ?? null;
}

/** One number: hidden flows passing. The total is in the column heading; the suite version in the tooltip. */
export function ScoreCell({ row, building, web, branch }: Props) {
  const found = scoreOf(row);
  if (!found) return <span className="wait">{building ? "—" : row.stages.score}</span>;
  const [version, s] = found;
  const link = web && row.dir ? `${web}/blob/${branch}/${row.dir}/rescore/${version}/per-story.md` : null;
  const title = `${s.passed} of ${s.total} hidden flows pass · suite ${version}${s.flaky ? ` · ${s.flaky} flaky` : ""} · per-story results`;
  const n = <strong className="score-n">{s.passed}</strong>;
  return link ? <a href={link} target="_blank" rel="noopener" title={title}>{n}</a> : <span title={title}>{n}</span>;
}
