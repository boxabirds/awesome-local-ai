import type { ConnectionState } from './connectBoard';

export const CONNECTION_STATUS_LABEL = 'Connection status';

const TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/**
 * Small badge at the top centre: hidden while normally connected, "Connecting…" on first
 * load, amber "Reconnecting…" while the connection is lost, green "Connected" briefly after
 * it returns; red "This board couldn't be loaded. Retrying…" when the saved board cannot be
 * loaded (the only state in which the board is not editable, see `canEdit`).
 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      role="status"
      aria-label={CONNECTION_STATUS_LABEL}
      data-state={state}
    >
      {TEXT[state]}
    </div>
  );
}
