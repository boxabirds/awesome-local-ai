// Connection status badge (story 3, sync.client): top centre.
// Hidden while stably connected; "Connecting…" on first load; amber
// "Reconnecting…" while disconnected after a connection; green "Connected"
// for CONNECTED_CONFIRMATION_MS after a reconnection. The board stays
// editable in every state.

import type { ReactElement } from 'react';
import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: { state: ConnectionState }): ReactElement | null {
  if (state === 'connected') return null;
  const tone = state === 'confirmed' ? 'is-green' : 'is-amber';
  return (
    <div
      role="status"
      className={`connection-status ${tone}`}
      data-state={state}
      data-testid="connection-status"
    >
      {LABELS[state]}
    </div>
  );
}
