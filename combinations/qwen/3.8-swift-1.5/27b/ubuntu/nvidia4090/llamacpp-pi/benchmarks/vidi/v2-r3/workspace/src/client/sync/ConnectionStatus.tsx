import type { ConnectionState } from './connectBoard';

const STATE_CONFIG: Record<ConnectionState, { text: string; color: string; className: string }> = {
  connecting: { text: 'Connecting…', color: '#666', className: 'status-connecting' },
  connected: { text: 'Connected', color: '#10b981', className: 'status-connected' },
  reconnecting: { text: 'Reconnecting…', color: '#f59e0b', className: 'status-degraded' },
  confirmed: { text: 'Connected', color: '#10b981', className: 'status-connected' },
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const { text, color, className } = STATE_CONFIG[state];

  return (
    <div
      data-testid="connection-status"
      role="status"
      aria-label={text}
      className={className}
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 13,
        fontWeight: 500,
        color: '#fff',
        backgroundColor: color,
        zIndex: 100,
      }}
    >
      {text}
    </div>
  );
}
