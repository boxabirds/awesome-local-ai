import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/** Badge text for each state; `connected` renders nothing at all. */
const TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

/**
 * Connection status badge, top centre (design "sync.client").
 *
 * Hidden while everything is normal, amber "Reconnecting…" while the connection
 * to the board is lost, green "Connected" for CONNECTED_CONFIRMATION_MS after a
 * reconnection and "Connecting…" while the board is still loading for the first
 * time. It is information only: the board stays fully editable in every state,
 * and the component never blocks pointer or keyboard input.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;
  const label = TEXT[state];
  return (
    <div
      className="connection-status"
      data-testid="connection-status"
      data-state={state}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
}
