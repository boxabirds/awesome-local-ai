import type { Row, State } from "../../shared/types.ts";
import { ActivityCell } from "./ActivityCell.tsx";
import { JudgeCell } from "./JudgeCell.tsx";
import { LinksCell } from "./LinksCell.tsx";
import { FlowsCell } from "./FlowsCell.tsx";
import { ScoreCell } from "./ScoreCell.tsx";
import { StatusCell } from "./StatusCell.tsx";
import { StoryCell } from "./StoryCell.tsx";
import { TimeCell } from "./TimeCell.tsx";

interface Props { row: Row; state: State; serverNow: number | null }

export function RunRow({ row, state, serverNow }: Props) {
  const building = row.stages.score === "waiting for the build";
  return (
    <tr data-stack={row.stack} data-run={row.runId}>
      <td>
        <div className="stack-label" title={row.stack}>{row.label}</div>
        <div className="run">{row.runId}</div>
        <div className="small mono">{row.packVersion || row.suite}</div>
      </td>
      <td><StatusCell row={row} /></td>
      <td><StoryCell row={row} /></td>
      <td><TimeCell row={row} serverNow={serverNow} /></td>
      <td><ActivityCell row={row} /></td>
      <td><FlowsCell row={row} /></td>
      <td><ScoreCell row={row} building={building} web={state.web} branch={state.branch} /></td>
      <td><JudgeCell judge={row.stages.judge} building={building} url={state.judgeUrl} /></td>
      <td><LinksCell row={row} web={state.web} branch={state.branch} /></td>
    </tr>
  );
}
