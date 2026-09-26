import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * The connection badge. `role="status"` so assistive tech announces changes.
 * It renders NOTHING while the state is `connected` (the common case): the
 * board never carries a permanent badge. States:
 *
 *   connecting  → "Connecting…"   (neutral)
 *   reconnecting → "Reconnecting…" (amber)
 *   confirmed   → "Connected"     (green, for CONNECTED_CONFIRMATION_MS)
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;
  const text =
    state === 'reconnecting' ? 'Reconnecting…' : state === 'confirmed' ? 'Connected' : 'Connecting…';
  return (
    <div
      role="status"
      data-testid="connection-status"
      data-state={state}
      className={`connection-badge connection-badge--${state}`}
    >
      {text}
    </div>
  );
}

export default ConnectionStatus;