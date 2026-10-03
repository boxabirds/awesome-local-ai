/**
 * Connection status badge, top centre.
 *
 * - hidden while normally connected
 * - grey "Connecting…" during first load
 * - amber "Reconnecting…" while the connection is lost
 * - green "Connected" for CONNECTED_CONFIRMATION_MS after a reconnection
 */

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

const TEXT = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  'load-failed': 'This board failed to load',
} as const;

const BACKGROUND = {
  connecting: '#5f6368',
  reconnecting: '#f9ab00', // amber
  confirmed: '#1e8e3e', // green
  'load-failed': '#d93025', // red
} as const;

export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  const { state } = props;
  if (state === 'connected') return null;
  const isLoadFailed = state === 'load-failed';
  return (
    <div
      role="status"
      data-testid="connection-status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1001,
        padding: '4px 12px',
        borderRadius: 12,
        backgroundColor: BACKGROUND[state],
        color: 'white',
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {TEXT[state]}
    </div>
  );
}
