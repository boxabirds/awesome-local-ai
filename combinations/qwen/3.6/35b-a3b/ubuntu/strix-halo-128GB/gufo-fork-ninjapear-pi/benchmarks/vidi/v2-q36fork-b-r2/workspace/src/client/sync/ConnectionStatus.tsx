import * as React from 'react';
import { ConnectionState } from './connectBoard';

interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * Connection status badge.
 * - 'connecting' → "Connecting…" (shown once during initial load)
 * - 'connected'  → hidden
 * - 'reconnecting' → amber "Reconnecting…"
 * - 'confirmed'  → green "Connected" (for CONNECTED_CONFIRMATION_MS after reconnection)
 */
export function ConnectionStatus(props: ConnectionStatusProps): React.JSX.Element | null {
  const { state } = props;

  if (state === 'connected') return null;

  let text: string;
  let style: React.CSSProperties;

  switch (state) {
    case 'connecting':
      text = 'Connecting…';
      style = {
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#fbbf24',
        color: '#1a1a1a',
        padding: '4px 12px',
        borderRadius: '9999px',
        fontSize: 12,
        fontWeight: 600,
        zIndex: 1000,
        pointerEvents: 'none',
      };
      break;

    case 'reconnecting':
      text = 'Reconnecting…';
      style = {
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#fbbf24', // amber
        color: '#1a1a1a',
        padding: '4px 12px',
        borderRadius: '9999px',
        fontSize: 12,
        fontWeight: 600,
        zIndex: 1000,
        pointerEvents: 'none',
      };
      break;

    case 'confirmed':
      text = 'Connected';
      style = {
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#34d399', // green
        color: '#1a1a1a',
        padding: '4px 12px',
        borderRadius: '9999px',
        fontSize: 12,
        fontWeight: 600,
        zIndex: 1000,
        pointerEvents: 'none',
      };
      break;

    default:
      return null;
  }

  return <div role="status" aria-live="polite" style={style}>{text}</div>;
}
