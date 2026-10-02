/**
 * The connection badge, top centre of the screen.
 *
 * It is a function of the connection state and nothing else: the board stays
 * editable in every state, so the badge never covers or disables anything.
 */
import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

const LABEL: Record<ConnectionState, string | null> = {
  /** The first load: the badge is not shown yet, the board is being opened. */
  connecting: 'Connecting…',
  /** In sync — nothing to say. */
  connected: null,
  /** The connection dropped after it had worked; edits are still accepted. */
  reconnecting: 'Reconnecting…',
  /** Just came back, for CONNECTED_CONFIRMATION_MS. */
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  const label = LABEL[state];
  if (label === null) return null;

  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      role="status"
    >
      {label}
    </div>
  );
}
