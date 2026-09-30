import React from 'react';
import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * Connection status badge, top centre.
 * - "Connecting…" while first loading
 * - amber "Reconnecting…" while disconnected after having been connected
 * - green "Connected" for CONNECTED_CONFIRMATION_MS after reconnection
 * - red "This board couldn't be loaded. Retrying…" while the board failed to load
 * - hidden when in the normal `connected` state
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;

  const styles: React.CSSProperties = {
    position: 'fixed',
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '4px 12px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 500,
    zIndex: 1000,
    pointerEvents: 'none',
    ...(state === 'load_failed'
      ? { backgroundColor: '#E53935', color: '#fff' }
      : state === 'reconnecting'
        ? { backgroundColor: '#FFA000', color: '#fff' }
        : state === 'confirmed'
          ? { backgroundColor: '#4CAF50', color: '#fff' }
          : { backgroundColor: '#90A4AE', color: '#fff' }),
  };

  const text =
    state === 'load_failed'
      ? 'This board couldn\u2019t be loaded. Retrying\u2026'
      : state === 'reconnecting'
        ? 'Reconnecting\u2026'
        : state === 'confirmed'
          ? 'Connected'
          : 'Connecting\u2026';

  return (
    <div role="status" aria-label="Connection status" data-testid="connection-status" style={styles}>
      {text}
    </div>
  );
}
