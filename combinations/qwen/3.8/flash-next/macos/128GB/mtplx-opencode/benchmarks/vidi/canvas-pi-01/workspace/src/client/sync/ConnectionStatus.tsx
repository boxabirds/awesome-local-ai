/**
 * Story 3 · connection status badge (design "Client connection and status").
 *
 * A presentational `role="status"` region that reflects the current
 * `ConnectionState`. It is deliberately inert: it renders text and nothing
 * else, so it can never lock the board. The board stays editable in every
 * state (TC-21) — this component has no pointer-events and no overlay.
 *
 * Hidden while `connected`: a healthy connection shows nothing (the badge only
 * exists to say "connecting", "reconnecting" or the brief green confirmation).
 */
import type { ConnectionState } from './connectionState';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  connected: '',
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-state={state}
    >
      {LABEL[state]}
    </div>
  );
}