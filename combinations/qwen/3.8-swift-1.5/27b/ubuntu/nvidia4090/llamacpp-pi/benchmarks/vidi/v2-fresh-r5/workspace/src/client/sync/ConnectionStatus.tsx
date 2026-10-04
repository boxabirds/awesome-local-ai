import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

const STATE_TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

const STATE_BACKGROUND: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: '#9AA0A6',
  reconnecting: '#FFB300',
  confirmed: '#34A853',
  load_failed: '#D93025',
};

/**
 * Top-centre connection status badge.
 * - Hidden while `connected` (normal operation).
 * - "Connecting…" during the first load.
 * - Amber "Reconnecting…" while the connection is lost.
 * - Green "Connected" for 2 seconds after a reconnection.
 * - Red "This board couldn't be loaded. Retrying…" while the room is
 *   unreadable (close code 4500); editing is locked (see {@link canEdit}).
 */
export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  const { state } = props;
  if (state === 'connected') return null;

  const text = STATE_TEXT[state];
  const background = STATE_BACKGROUND[state];

  return (
    <div
      role="status"
      data-testid="connection-status"
      aria-label={text}
      style={{
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1001,
        padding: '4px 12px',
        borderRadius: '9999px',
        background,
        color: '#1f1f1f',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}
