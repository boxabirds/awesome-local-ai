import type { ConnectionState } from './connectBoard';
import type React from 'react';

/**
 * Connection status badge shown at the top centre of the board.
 *
 * - 'connecting': shows "Connecting…"
 * - 'connected': hidden
 * - 'reconnecting': shows amber "Reconnecting…"
 * - 'confirmed': shows green "Connected" (auto-hides after CONNECTED_CONFIRMATION_MS via state machine)
 */
export function ConnectionStatus({ state }: { state: ConnectionState }): React.JSX.Element | null {
  if (state === 'connected') return null;

  if (state === 'connecting') {
    return (
      <div className="connection-status connecting" role="status">
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div className="connection-status reconnecting" role="status">
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div className="connection-status confirmed" role="status">
        Connected
      </div>
    );
  }

  return null;
}
