import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/** What the badge says in each state, or `null` when it is hidden. */
const LABELS: Record<ConnectionState, string | null> = {
  connecting: 'Connecting…',
  connected: null,
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: 'This board couldn\u2019t be loaded. Retrying\u2026',
};

/**
 * The connection status badge, top centre of the board.
 *
 * Hidden while everything is normal, amber "Reconnecting…" while the connection
 * is lost, green "Connected" for a moment after it comes back and
 * "Connecting…" during the first load. It never blocks the board: changes made
 * while offline go out on reconnect.
 *
 * Red "Couldn't load this board — retrying" is the exception. There the board is
 * read-only, and the retrying is real: the connection keeps trying on its own, so
 * the message is not an instruction to reload the page.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  const label = LABELS[state];
  if (label === null) return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      role="status"
      aria-live="polite"
      data-connection-state={state}
    >
      {label}
    </div>
  );
}
