import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, { text: string; bg: string; fg: string }> = {
  connecting: { text: 'Connecting…', bg: '#ECEFF1', fg: '#37474F' },
  reconnecting: { text: 'Reconnecting…', bg: '#FFC107', fg: '#3E2723' },
  confirmed: { text: 'Connected', bg: '#43A047', fg: '#FFFFFF' },
};

/** Top-centre connection badge; hidden while connected normally. Never blocks editing. */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  const label = LABELS[state];
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'none',
        padding: '4px 12px',
        borderRadius: 999,
        font: '500 13px system-ui, sans-serif',
        background: label.bg,
        color: label.fg,
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
      }}
    >
      {label.text}
    </div>
  );
}
