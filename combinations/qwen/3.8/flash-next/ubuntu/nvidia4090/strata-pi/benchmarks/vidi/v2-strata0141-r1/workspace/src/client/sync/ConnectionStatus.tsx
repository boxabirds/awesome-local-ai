import type { ConnectionState } from './connectBoard';

/**
 * The connection badge (anchor `live.status`).
 *
 * It is a live region, so its text is announced when it changes, and it renders
 * in every state — empty when there is nothing to report — so there is always
 * one place to look for the connection.
 *
 *   connecting   "Connecting…"    the room has not answered this client yet
 *   reconnecting "Reconnecting…"  a link that worked is down; the board works on
 *   confirmed    "Connected"      a lost link came back (hidden again after
 *                                 CONNECTED_CONFIRMATION_MS by the connection)
 *   connected    (nothing)        the normal state
 *
 * The board is never dimmed, covered, or disabled in any of these states: an
 * outage costs the person nothing but the badge (`live.status`).
 */

const TEXT: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  connected: '',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-connection-state={state}
      role="status"
      aria-live="polite"
    >
      {TEXT[state]}
    </div>
  );
}
