import type { Row, State } from "../../shared/types.ts";
import { RunRow } from "./RunRow.tsx";

interface Props { stack: string; rows: Row[]; state: State; serverNow: number | null }

const COLUMNS: [string, string][] = [
  ["Run", "10%"], ["Node", "9%"], ["Build", "27%"], ["Stories", "12%"],
  ["Live held-out", "11%"], ["Score", "12%"], ["Judge", "11%"], ["Links", "8%"],
];

/** One stack (combination) and its runs. */
export function StackSection({ stack, rows, state, serverNow }: Props) {
  return (
    <section data-stack={stack}>
      <h2>{stack}</h2>
      <table>
        <colgroup>{COLUMNS.map(([name, width]) => <col key={name} style={{ width }} />)}</colgroup>
        <thead>
          <tr>{COLUMNS.map(([name]) => <th key={name}>{name}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => <RunRow key={`${r.runId}:${r.live?.jobId ?? ""}`} row={r} state={state} serverNow={serverNow} />)}
        </tbody>
      </table>
    </section>
  );
}
