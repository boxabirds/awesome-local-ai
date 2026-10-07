// ConnectionStatus (stories 3+4): the connection status badge.
//
// - hidden while connected normally
// - "Connecting…" while first loading
// - amber "Reconnecting…" while disconnected
// - green "Connected" for 2 seconds after a reconnection (confirmed state)
// - red "This board couldn't be loaded. Retrying…" while load_failed (story 4)

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

  if (state === 'load_failed') {
    return (
      <div
        className="connection-badge connection-badge--load-failed"
        role="status"
        aria-label="Board load failed"
      >
        This board couldn't be loaded. Retrying…
      </div>
    );
  }

  return null;
}
