// The little status pill at the top-centre of the board. It is deliberately the
// only piece of connection chrome: while the link is down it says "Reconnecting…"
// (amber) and the board underneath stays fully usable, because edits go into the
// local Y.Doc regardless. The steady live state renders nothing at all — a board
// that is simply connected should not shout about it.
//
// `load_failed` is the exception, and is red for a reason: the room said it could
// not read this board. That is not a delay, so the pill does not promise a retry is
// under way, and the board underneath stops taking edits.

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';
import { BOARD_LOAD_FAILED_MESSAGE } from '../../shared/protocol';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: BOARD_LOAD_FAILED_MESSAGE,
};

export interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  return (
    <div
      role="status"
      data-testid="connection-status"
      data-state={state}
      className={`connection-status connection-status--${state}`}
    >
      {LABELS[state]}
    </div>
  );
}
