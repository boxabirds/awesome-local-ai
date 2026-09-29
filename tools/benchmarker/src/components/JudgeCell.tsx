interface Props { judge: string; building: boolean; url: string }

export function JudgeCell({ judge, building, url }: Props) {
  if (judge === "ready") return <a className="ready" href={url} target="_blank" rel="noopener">Judge →</a>;
  return <span className="wait">{building ? "—" : judge}</span>;
}
