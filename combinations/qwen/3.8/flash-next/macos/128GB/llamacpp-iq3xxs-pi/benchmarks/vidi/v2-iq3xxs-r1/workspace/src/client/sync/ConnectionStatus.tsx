import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * The connection badge (PRD conn.badge). Announced politely and never loudly: a
 * board that is in sync with its room renders *nothing*, so nobody reads a
 * status line out loud during an exercise.
 *
 * Everything the badge says is a statement about *this* connection, and the board
 * stays editable in every one of these states — nothing here is disabled, no
 * input is swallowed, and no modal appears (PRD conn.badge "the board stays
 * editable while the badge is up").
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;

  const label =
    state === 'connecting'
      ? 'Connecting…'
      : state === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connected';

  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      // `role="status"` is a polite live region: a screen reader announces the
      // change without interrupting what the person is doing.
      role="status"
    >
      {label}
    </div>
  );
}
