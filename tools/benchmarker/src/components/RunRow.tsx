import { useState } from "react";
import type { Row, State } from "../../shared/types.ts";
import { ActivityCell } from "./ActivityCell.tsx";
import { JudgeCell } from "./JudgeCell.tsx";
import { LinksCell } from "./LinksCell.tsx";
import { StoriesWorkingCell } from "./StoriesWorkingCell.tsx";
import { ScoreCell } from "./ScoreCell.tsx";
import { StatusCell } from "./StatusCell.tsx";
import { StoryCell } from "./StoryCell.tsx";
import { TimeCell } from "./TimeCell.tsx";
import { SpeedCell, StoryUsageTable, TokensCell } from "./UsageCells.tsx";

interface Props { row: Row; state: State; serverNow: number | null; columns: number }

export function RunRow({ row, state, serverNow, columns }: Props) {
  const [open, setOpen] = useState(false);
  const building = row.stages.score === "waiting for the build";
  return (
    <>
    <tr data-stack={row.stack} data-run={row.runId} className={open ? "opened" : undefined}>
      <td className="run-cell" onClick={() => setOpen(!open)} data-tip="Per-story tokens and speed">
        <div className="stack-label" data-tip={row.stack}>{row.label}</div>
        <div className="run">
          <button type="button" className="expand" aria-expanded={open} aria-label={`per-story detail for ${row.runId}`}>{open ? "▾" : "▸"}</button>
          {row.runId}
        </div>
        <div className="small mono">{row.packVersion || row.suite}</div>
      </td>
      <td><StatusCell row={row} /></td>
      <td><StoryCell row={row} /></td>
      <td><TimeCell row={row} serverNow={serverNow} /></td>
      <td><ActivityCell row={row} /></td>
      <td><StoriesWorkingCell row={row} /></td>
      <td className="tokens"><TokensCell row={row} /></td>
      <td className="speed"><SpeedCell row={row} /></td>
      <td><ScoreCell row={row} building={building} web={state.web} branch={state.branch} /></td>
      <td><JudgeCell row={row} building={building} url={state.judgeUrl} /></td>
      <td><LinksCell row={row} web={state.web} branch={state.branch} /></td>
    </tr>
    {open ? (
      <tr className="detail" data-stack={row.stack} data-run={row.runId}>
        <td colSpan={columns}><StoryUsageTable stories={row.stories} squares={row.storiesWorking.squares} /></td>
      </tr>
    ) : null}
    </>
  );
}
