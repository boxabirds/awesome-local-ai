import type { Row } from "../../shared/types.ts";

interface Props { row: Row; url: string }

/** The review page opened on this run (the gallery matches it by setup and run). */
export function judgeLink(url: string, row: Pick<Row, "stack" | "runId">): string {
  return `${url}?${new URLSearchParams({ setup: row.stack, run: row.runId })}`;
}

/** The way to judging, once the run can be judged (Row.judgeReady); nothing before. */
export function JudgeCell({ row, url }: Props) {
  if (!row.judgeReady) return null;
  return <a className="ready" href={judgeLink(url, row)} target="_blank" rel="noopener">Judge →</a>;
}
