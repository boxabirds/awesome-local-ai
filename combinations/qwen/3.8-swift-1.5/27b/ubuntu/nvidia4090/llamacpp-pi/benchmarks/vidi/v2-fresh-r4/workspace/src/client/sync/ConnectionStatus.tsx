import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge.
 * - Hidden when connected (normal state)
 * - "Connecting…" while first loading
 * - Amber "Reconnecting…" while disconnected
 * - Green "Connected" for 2 seconds after reconnection
 * - Red "This board couldn't be loaded. Retrying…" when the saved state failed to load
 */
export function ConnectionStatus(props: { state: ConnectionState }): import('react').JSX.Element | null {
  const { state } = props;

  if (state === 'connected') {
    return null;
  }

  if (state === 'connecting') {
    return (
      <div
        role="status"
        aria-label="Connecting"
        className="connection-status connection-status--connecting"
      >
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div
        role="status"
        aria-label="Reconnecting"
        className="connection-status connection-status--reconnecting"
      >
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div
        role="status"
        aria-label="Connected"
        className="connection-status connection-status--connected"
      >
        Connected
      </div>
    );
  }

  if (state === 'load_failed') {
    return (
      <div
        role="status"
        aria-label="Load failed"
        className="connection-status connection-status--load-failed"
      >
        This board couldn't be loaded. Retrying…
      </div>
    );
  }

  return null;
}
