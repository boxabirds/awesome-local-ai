import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  load_failed: "This board couldn't be loaded. Retrying…",
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  return (
    <div role="status" className={`connection-status connection-status--${state}`}>
      {LABELS[state]}
    </div>
  );
}
