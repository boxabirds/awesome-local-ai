// The little badge at the top centre that says what the connection is doing.
// It is absent while everything is fine, amber while the room is unreachable,
// green for a moment after it comes back, and red when the board itself could
// not be loaded. In every state except the red one the board stays fully
// editable — edits go into the local Y.Doc whether or not the socket is up. Only
// the red `load_failed` state locks editing, because there is no board on screen
// to edit: the room could not read it from storage.

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
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
