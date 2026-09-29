import type { Row, State } from "../../shared/types.ts";
import { BuildCell } from "./BuildCell.tsx";
import { JudgeCell } from "./JudgeCell.tsx";
import { LinksCell } from "./LinksCell.tsx";
import { LiveHeldOut } from "./LiveHeldOut.tsx";
import { ScoreCell } from "./ScoreCell.tsx";
import { StoriesStrip } from "./StoriesStrip.tsx";

interface Props { row: Row; state: State; serverNow: number | null }

export function RunRow({ row, state, serverNow }: Props) {
  const building = row.stages.score === "waiting for the build";
  return (
    <tr data-run={row.runId} data-node={row.node ?? ""}>
      <td className="run">
        {row.runId}
        <div className="small mono">{row.packVersion || row.suite}</div>
      </td>
      <td className="node">{row.node ?? "—"}</td>
      <td><BuildCell row={row} serverNow={serverNow} /></td>
      <td><StoriesStrip row={row} /></td>
      <td><LiveHeldOut stories={row.stories} /></td>
      <td><ScoreCell row={row} building={building} web={state.web} branch={state.branch} /></td>
      <td><JudgeCell judge={row.stages.judge} building={building} url={state.judgeUrl} /></td>
      <td><LinksCell row={row} web={state.web} branch={state.branch} /></td>
    </tr>
  );
}
