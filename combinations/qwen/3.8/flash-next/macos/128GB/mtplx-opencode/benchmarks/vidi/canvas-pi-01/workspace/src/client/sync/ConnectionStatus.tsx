/**
 * Story 3 · connection status badge (design "Client connection and status").
 *
 * A presentational `role="status"` region that reflects the current
 * `ConnectionState`. It is deliberately inert: it renders text and nothing
 * else, so it can never itself lock the board (the editing gate lives in
 * `App.canEdit`).
 *
 * Hidden while `connected`: a healthy connection shows nothing (the badge only
 * exists to say "connecting", "reconnecting", the brief green confirmation, or
 * that the board could not be loaded).
 *
 * `load_failed` (story 4) renders in red and is the one state that goes with a
 * locked canvas: the room could not read this board, so typing into it would
 * invent a second version of it.
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
  load_failed: 'This board couldn’t be loaded. Retrying…',
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