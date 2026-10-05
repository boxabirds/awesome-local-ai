/**
 * The connection badge, top centre of the board.
 *
 * It is quiet by design: nothing at all while the board is in sync, "Connecting…"
 * during the first load, amber "Reconnecting…" while a connection is lost (the
 * board stays fully editable the whole time) and green "Connected" for
 * CONNECTED_CONFIRMATION_MS after it comes back.
 */

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

/** The words shown for each state that needs words. */
const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected'
};

export interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus(props: ConnectionStatusProps): JSX.Element | null {
  if (props.state === 'connected') return null;
  return (
    <div
      className={`vidi6-connection vidi6-connection--${props.state}`}
      data-vidi6="connection-status"
      data-state={props.state}
      role="status"
    >
      {LABELS[props.state]}
    </div>
  );
}
