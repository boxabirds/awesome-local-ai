import type { Row } from "../../shared/types.ts";
import { recordHref } from "../../shared/recordLinks.ts";

interface Props { row: Row }

/** The run's record and its summary, served by the app from the lake (shared/recordLinks.ts). */
export function LinksCell({ row }: Props) {
  if (!row.dir) return <span className="wait">—</span>;
  const ended = row.state === "finished" || row.state === "stopped";
  return (
    <span className="links">
      <a href={recordHref(row.dir)} target="_blank" rel="noopener">record</a>
      {ended ? <a href={recordHref(row.dir, "summary.md")} target="_blank" rel="noopener">summary</a> : null}
    </span>
  );
}
