import type { ConnectionState } from './connectBoard';

/**
 * Connection status badge shown at the top centre of the board.
 * - Hidden when state is 'connected'
 * - Shows "Connecting…" when state is 'connecting'
 * - Shows amber "Reconnecting…" when state is 'reconnecting'
 * - Shows green "Connected" when state is 'confirmed'
 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') {
    return null;
  }

  let text: string;
  let color: string;

  switch (state) {
    case 'connecting':
      text = 'Connecting…';
      color = '#666';
      break;
    case 'reconnecting':
      text = 'Reconnecting…';
      color = '#F59E0B'; // amber
      break;
    case 'confirmed':
      text = 'Connected';
      color = '#10B981'; // green
      break;
  }

  return (
    <div
      role="status"
      aria-label={text}
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 12px',
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 500,
        color: '#fff',
        backgroundColor: color,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}
