/**
 * Connection status badge.
 * Shows "Connecting…" while first loading, amber "Reconnecting…" when disconnected,
 * green "Connected" for CONNECTED_CONFIRMATION_MS after reconnection.
 * Hidden when normally connected.
 */
import type React from 'react';
import type { ConnectionState } from './connectBoard';

export function ConnectionStatus(props: { state: ConnectionState }): React.JSX.Element | null {
  const { state } = props;

  if (state === 'connected') return null;

  if (state === 'connecting') {
    return (
      <div role="status" className="connection-status connection-status--connecting">
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div role="status" className="connection-status connection-status--reconnecting">
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div role="status" className="connection-status connection-status--confirmed">
        Connected
      </div>
    );
  }

  return null;
}
