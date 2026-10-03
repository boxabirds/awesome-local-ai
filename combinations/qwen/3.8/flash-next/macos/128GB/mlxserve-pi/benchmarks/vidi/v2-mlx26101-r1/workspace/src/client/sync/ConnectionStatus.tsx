// The little badge at the top centre that says what the connection is doing.
// It is absent while everything is fine, amber while the room is unreachable,
// and green for a moment after it comes back. Nothing else changes: the board
// stays fully editable in every state, because edits go into the local Y.Doc
// whether or not the socket is up.

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

/**
 * Connection badge, or `null` when the board is connected and in sync — the
 * normal state, which should not have anything drawn on screen.
 */
export function ConnectionStatus({
  state,
}: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  const label = LABELS[state];
  return (
    <div
      data-testid="connection-status"
      role="status"
      className={`connection-status connection-status--${state}`}
      data-state={state}
    >
      {label}
    </div>
  );
}
