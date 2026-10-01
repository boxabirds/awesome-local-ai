import type { ConnectionState } from './connectBoard';

const TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: 'This board couldn\'t be loaded. Retrying…',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  return (
    <div className={`connection-status connection-status--${state}`} role="status" data-testid="connection-status">
      {TEXT[state]}
    </div>
  );
}
