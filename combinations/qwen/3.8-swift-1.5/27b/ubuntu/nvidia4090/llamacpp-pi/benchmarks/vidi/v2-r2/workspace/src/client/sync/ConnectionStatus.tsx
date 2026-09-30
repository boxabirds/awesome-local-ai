import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * Connection status badge, top centre.
 * - Hidden when 'connected'
 * - "Connecting…" when 'connecting'
 * - Amber "Reconnecting…" when 'reconnecting'
 * - Green "Connected" when 'confirmed'
 * - Red "This board couldn't be loaded. Retrying…" when 'load_failed'
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
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
    case 'load_failed':
      text = "This board couldn't be loaded. Retrying…";
      color = '#DC2626'; // red
      break;
    default:
      return null;
  }

  return (
    <div
      role="status"
      aria-label={text}
      style={{
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 12px',
        borderRadius: '4px',
        backgroundColor: color,
        color: '#fff',
        fontSize: '13px',
        fontWeight: 500,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}
