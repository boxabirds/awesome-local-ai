/**
 * The badge that says whether other people can see this board right now.
 *
 * It is deliberately quiet: while the board is connected it is not in the way at
 * all, because a connection that works needs no commentary. It appears for the two
 * moments a person has to be told about — the board is still loading, or the board
 * is not reaching anybody — and shows "Connected" for a couple of seconds after a
 * drop so the return is as visible as the loss was.
 *
 * Nothing here blocks the board. A reconnecting board is still a board: everything
 * typed goes into the document and is sent as soon as the connection is back.
 */
import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/** What the badge says in each state; a connected board says nothing. */
const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  connected: '',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  const label = LABELS[state];
  if (label === '') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      // A polite live region: a screen reader is told the connection changed, and
      // what the badge says is the text itself, not an attribute.
      role="status"
    >
      {label}
    </div>
  );
}
