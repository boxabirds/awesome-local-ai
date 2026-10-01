import type { ConnectionState } from './connectBoard';

const BADGES: Partial<Record<ConnectionState, { text: string; background: string; color: string }>> = {
  connecting: { text: 'Connecting…', background: '#eceff1', color: '#37474f' },
  reconnecting: { text: 'Reconnecting…', background: '#ffb300', color: '#3e2723' },
  load_failed: { text: "This board couldn't be loaded. Retrying…", background: '#c62828', color: '#fff' },
  confirmed: { text: 'Connected', background: '#2e7d32', color: '#fff' },
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const badge = BADGES[state];
  if (!badge) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: '4px 14px',
        borderRadius: 999,
        font: '600 13px system-ui, sans-serif',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
        background: badge.background,
        color: badge.color,
      }}
    >
      {badge.text}
    </div>
  );
}
