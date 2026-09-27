// The connection status badge. Presentational only — driven by ConnectionState.
// Renders nothing in the steady 'connected' state so it never distracts.
import type { ConnectionState } from './connectBoard.ts';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps): React.JSX.Element | null {
  if (state === 'connected') return null;
  const label =
    state === 'connecting' ? 'Connecting…' : state === 'reconnecting' ? 'Reconnecting…' : 'Connected';
  const color = state === 'confirmed' ? '#1a7f37' : '#b26a00';
  return (
    <div
      role="status"
      data-state={state}
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 10,
        padding: '4px 10px',
        borderRadius: 6,
        background: '#fff',
        border: `1px solid ${color}`,
        color,
        font: '500 13px/1 system-ui, sans-serif',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        pointerEvents: 'none',
      }}
    >
      {label}
    </div>
  );
}
