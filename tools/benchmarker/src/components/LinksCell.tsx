import type { Row } from "../../shared/types.ts";

interface Props { row: Row; web: string | null; branch: string }

export function LinksCell({ row, web, branch }: Props) {
  if (!row.dir || !web) return <span className="wait">—</span>;
  const ended = row.state === "finished" || row.state === "stopped";
  return (
    <span className="links">
      <a href={`${web}/tree/${branch}/${row.dir}`} target="_blank" rel="noopener">record</a>
      {ended ? <a href={`${web}/blob/${branch}/${row.dir}/summary.md`} target="_blank" rel="noopener">summary</a> : null}
    </span>
  );
}
