import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge (PRD live.connection_status): top centre, hidden
 * while the board is in sync, amber "Reconnecting…" while the connection is
 * down, green "Connected" for `CONNECTED_CONFIRMATION_MS` after a drop, and
 * "Connecting…" during the first connection.
 *
 * It is a pure indicator: nothing here covers or disables the canvas, and the
 * board stays fully editable behind it in every state except `load_failed` —
 * see {@link canEdit}.
 */

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  // PRD persist.load_failure, verbatim: a board that could not be loaded is
  // never presented as an empty one.
  load_failed: "This board couldn't be loaded. Retrying…",
};

/**
 * Whether the user may change the board in this connection state.
 *
 * Only `load_failed` locks it. A board that could not be loaded is not the
 * user's board: typing into it would be thrown away on the next retry, and an
 * editable empty board is what "someone deleted my notes" looks like. Every
 * other state — including `reconnecting`, where the room's own storage failed —
 * keeps the board editable, because those changes live in the local document
 * and are re-sent as soon as the connection is back.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

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
