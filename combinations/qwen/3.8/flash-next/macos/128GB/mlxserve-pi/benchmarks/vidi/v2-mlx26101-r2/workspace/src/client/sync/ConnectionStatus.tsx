import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard.js';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * What each state says. A board that is in step with its room shows nothing:
 * `connected` is the state the user should never see.
 */
export const CONNECTION_STATUS_TEXTS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

/**
 * The connection badge (design "connection-status"): top centre, announced to a
 * screen reader as a live region, amber while the room cannot be reached and
 * green for the moment the connection comes back.
 *
 * It takes `pointer-events: none` (styles.css) — a badge must never swallow a
 * click, a drag or a pinch from the board, and it never covers a control: the
 * toolbar is on the left edge and the zoom controls in the bottom-right corner.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      role="status"
    >
      {CONNECTION_STATUS_TEXTS[state]}
    </div>
  );
}
