import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

// Top-centre status badge. Hidden while the connection is healthy so the
// board is unobstructed; "Connected" flashes briefly (state `confirmed`)
// after a recovery, then the state settles to `connected` and the badge
// disappears. The board stays fully editable in every state — this badge
// never blocks input.
const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…"
};

const COLORS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: '#6b7280',
  reconnecting: '#b45309',
  confirmed: '#15803d',
  load_failed: '#dc2626'
};

export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  if (props.state === 'connected') return null;
  return (
    <div
      role="status"
      data-testid="connection-status"
      data-state={props.state}
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        padding: '4px 12px',
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.92)',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
        font: '500 13px system-ui, sans-serif',
        color: COLORS[props.state],
        pointerEvents: 'none'
      }}
    >
      {LABELS[props.state]}
    </div>
  );
}
