import type { Row } from "../../shared/types.ts";

interface Props { row: Row; building: boolean; url: string }

/** The review page opened on this run (the gallery matches it by setup and run). */
export function judgeLink(url: string, row: Pick<Row, "stack" | "runId">): string {
  return `${url}?${new URLSearchParams({ setup: row.stack, run: row.runId })}`;
}

export function JudgeCell({ row, building, url }: Props) {
  const judge = row.stages.judge;
  if (judge === "ready") return <a className="ready" href={judgeLink(url, row)} target="_blank" rel="noopener">Judge →</a>;
  return <span className="wait">{building ? "—" : judge}</span>;
}
