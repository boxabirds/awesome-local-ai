import { useSyncExternalStore } from 'react';
import type { BoardConnection, SyncStatus } from './connectBoard';

const LABELS: Record<Exclude<SyncStatus, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected'
};

// Top-centre badge. Hidden while the connection is healthy so it never
// competes with the board for attention.
export function ConnectionStatus({ status }: { status: SyncStatus }) {
  if (status === 'connected') return null;
  return (
    <div className={`connection-status connection-status--${status}`} role="status">
      {LABELS[status]}
    </div>
  );
}

const SUBSCRIBE_NONE = () => () => {};
const STATUS_CONNECTED = (): SyncStatus => 'connected';

// Status of a live connection, or 'connected' (badge hidden) when there is
// none — e.g. tests that inject a bare Y.Doc.
export function useConnectionStatus(
  connection: BoardConnection | null
): SyncStatus {
  return useSyncExternalStore(
    connection === null ? SUBSCRIBE_NONE : connection.subscribe,
    connection === null ? STATUS_CONNECTED : connection.status
  );
}
