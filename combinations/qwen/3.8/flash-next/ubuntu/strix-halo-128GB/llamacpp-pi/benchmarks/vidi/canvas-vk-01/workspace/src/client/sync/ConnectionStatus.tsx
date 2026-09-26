import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge (PRD live.connection_status): top centre, hidden
 * while the board is in sync, amber "Reconnecting…" while the connection is
 * down, green "Connected" for `CONNECTED_CONFIRMATION_MS` after a drop, and
 * "Connecting…" during the first connection.
 *
 * It is a pure indicator: the board stays fully editable behind it in every
 * state (nothing here covers or disables the canvas).
 */

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  const label = LABELS[state];
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-state={state}
      className={`connection-status connection-status--${state}`}
    >
      {label}
    </div>
  );
}
