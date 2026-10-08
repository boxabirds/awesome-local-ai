import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge (story 3, PRD live.status), top centre.
 *
 * Hidden while connected normally; amber "Reconnecting…" while the
 * connection is lost; green "Connected" for CONNECTED_CONFIRMATION_MS
 * after a reconnection; grey "Connecting…" during the first load.
 * `pointerEvents: none` and no board lockout: the board stays fully
 * editable in every state.
 */

interface BadgeStyle {
  text: string;
  color: string;
}

const BADGES: Record<Exclude<ConnectionState, 'connected'>, BadgeStyle> = {
  connecting: { text: 'Connecting…', color: '#6b7280' },
  reconnecting: { text: 'Reconnecting…', color: '#d97706' }, // amber
  confirmed: { text: 'Connected', color: '#16a34a' }, // green
};

export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  if (props.state === 'connected') {
    return null;
  }
  const { text, color } = BADGES[props.state];
  return (
    <div
      role="status"
      data-connection-state={props.state}
      data-testid="connection-status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 4000,
        padding: '4px 12px',
        borderRadius: 9999,
        background: '#ffffff',
        border: `1px solid ${color}`,
        color,
        font: '500 13px/1.4 system-ui, sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}
