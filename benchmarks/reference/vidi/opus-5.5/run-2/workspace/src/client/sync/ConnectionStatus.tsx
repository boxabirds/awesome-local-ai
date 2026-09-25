/**
 * Connection status badge, top centre (anchor: sync.client). Hidden while connected;
 * "Connecting…" on first load, amber "Reconnecting…" while disconnected, green
 * "Connected" for CONNECTED_CONFIRMATION_MS after a reconnection; red "This board couldn't be
 * loaded. Retrying…" while the saved board cannot be loaded (story 4, editing is locked).
 */
import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

export function ConnectionStatus(props: { state: ConnectionState }): React.JSX.Element | null {
  if (props.state === 'connected') return null;
  return (
    <div className="connection-status" role="status" data-state={props.state} data-testid="connection-status">
      {LABELS[props.state]}
    </div>
  );
}
