// ConnectionStatus (story 3): the connection status badge.
//
// - hidden while connected normally
// - "Connecting…" while first loading
// - amber "Reconnecting…" while disconnected
// - green "Connected" for 2 seconds after a reconnection (confirmed state)

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  if (state === 'connected') return null;

  if (state === 'connecting') {
    return (
      <div className="connection-badge" role="status" aria-label="Connecting">
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div className="connection-badge connection-badge--reconnecting" role="status" aria-label="Reconnecting">
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div className="connection-badge connection-badge--connected" role="status" aria-label="Connected">
        Connected
      </div>
    );
  }

  return null;
}
