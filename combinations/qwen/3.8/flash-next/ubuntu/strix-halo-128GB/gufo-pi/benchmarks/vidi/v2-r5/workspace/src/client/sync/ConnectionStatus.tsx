import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * Connection status badge displayed at the top centre.
 *
 * - 'connecting': shows "Connecting…"
 * - 'connected': hidden
 * - 'reconnecting': shows amber "Reconnecting…"
 * - 'confirmed': shows green "Connected" (for CONNECTED_CONFIRMATION_MS)
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;

  return (
    <div
      role="status"
      data-testid="connection-status"
      className={`connection-status connection-status--${state}`}
    >
      {state === 'connecting' && <span>Connecting…</span>}
      {state === 'reconnecting' && <span>Reconnecting…</span>}
      {state === 'confirmed' && <span>Connected</span>}
    </div>
  );
}
