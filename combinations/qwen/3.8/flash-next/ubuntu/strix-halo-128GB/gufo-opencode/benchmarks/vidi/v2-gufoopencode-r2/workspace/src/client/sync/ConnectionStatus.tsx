// Top-centre connection badge. Hidden while connected: the board stays
// editable in every state, so nothing else about the UI changes.

import type { ReactElement } from 'react';
import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus(props: { state: ConnectionState }): ReactElement | null {
  if (props.state === 'connected') return null;
  return (
    <div
      role="status"
      className={`connection-status connection-status--${props.state}`}
    >
      {LABELS[props.state]}
    </div>
  );
}
