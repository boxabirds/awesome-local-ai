// Connection status badge (see spec: sync.client, PRD "Connection status is
// visible").
//
// Top centre; hidden while connected normally:
//   connecting   -> "Connecting…"
//   reconnecting -> amber "Reconnecting…"
//   confirmed    -> green "Connected" (CONNECTED_CONFIRMATION_MS after a
//                   reconnection, then the state returns to 'connected' and
//                   the badge hides)
//
// The badge never blocks editing: in every state the board stays fully
// editable (offline edits catch up on reconnect, live.catch_up).

import type { ConnectionState } from './connectBoard';

const BADGE_TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus(props: { state: ConnectionState }) {
  if (props.state === 'connected') return null;
  return (
    <div
      role="status"
      aria-label="Connection status"
      data-testid="connection-status"
      className={`connection-badge connection-badge--${props.state}`}
    >
      {BADGE_TEXT[props.state]}
    </div>
  );
}
