import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

/**
 * The connection badge (`sync.client`).
 *
 * It reports the connection, never the board: whatever its state, the board
 * stays fully editable and edits keep going into the local document.
 */

const LABELS = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
} as const;

export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  if (state === 'connected') {
    // A working connection is normal: it has no place on the screen.
    return null;
  }
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      data-vidi6-overlay="true"
      role="status"
    >
      <span className="connection-status__dot" aria-hidden="true" />
      <span className="connection-status__label">{LABELS[state]}</span>
    </div>
  );
}
