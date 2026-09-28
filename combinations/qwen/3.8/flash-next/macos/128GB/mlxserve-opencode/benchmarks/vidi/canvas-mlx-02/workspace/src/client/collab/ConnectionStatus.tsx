// The connection status badge. Presentational only - driven by ConnectionState.
// Renders nothing in the steady 'connected' state so it never distracts.
import type { ConnectionState } from './connectBoard.ts';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const AMBER = '#b26a00';
const GREEN = '#1a7f37';
// Red is reserved for the one message that is not about connectivity: the board
// itself could not be read by the server (TC-22 asserts this colour).
const RED = '#c62828';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

export function ConnectionStatus({ state }: ConnectionStatusProps): React.JSX.Element | null {
  if (state === 'connected') return null;
  const label = LABELS[state];
  const color = state === 'confirmed' ? GREEN : state === 'load_failed' ? RED : AMBER;
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
        maxWidth: 320,
      }}
    >
      {label}
    </div>
  );
}
