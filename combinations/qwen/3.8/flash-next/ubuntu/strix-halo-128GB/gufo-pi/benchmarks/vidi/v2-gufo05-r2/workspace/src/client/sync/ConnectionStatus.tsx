/**
 * sync.client: the connection badge. Top centre, and out of the way as soon as
 * everything is in sync: a board that works needs no announcement. What it does
 * say, when it says anything: "Connecting…" during the first load, amber
 * "Reconnecting…" while a connection is being restored (the board stays fully
 * editable the whole time — edits wait in the local document), and green
 * "Connected" briefly when the connection comes back.
 */

import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      role="status"
      data-testid="connection-status"
      data-state={state}
    >
      {LABELS[state]}
    </div>
  );
}
