import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  return (
    <div role="status" className={`connection-status connection-${state}`}>
      {LABELS[state]}
    </div>
  );
}
