import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge displayed at the top centre of the board.
 *
 * - 'connecting': shows "Connecting…"
 * - 'connected': hidden
 * - 'reconnecting': shows amber "Reconnecting…"
 * - 'confirmed': shows green "Connected" (briefly after reconnection)
 * - 'load_failed': shows red "This board couldn't be loaded. Retrying…"
 *
 * The board stays editable except in 'load_failed' state.
 */
export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
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

  if (state === 'load_failed') {
    return (
      <div role="status" className="connection-status connection-status--load-failed">
        This board couldn&apos;t be loaded. Retrying…
      </div>
    );
  }

  return null;
}
