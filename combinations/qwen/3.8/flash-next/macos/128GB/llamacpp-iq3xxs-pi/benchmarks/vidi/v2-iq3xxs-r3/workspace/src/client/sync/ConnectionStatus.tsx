import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/**
 * The connection badge (live.status): top centre, hidden while everything is
 * normal. Its whole contract is the text and the colour of one state. The board
 * behind it is never disabled by a bad *connection* — story 3 kept that rule for
 * every state it had — but `load_failed` is not about the connection: it is the
 * room saying this board could not be read, and while it is on screen the board
 * is not editable (`canEdit`, App).
 */
export interface ConnectionStatusProps {
  readonly state: ConnectionState;
}

/** The only text the user sees per state; `connected` shows nothing at all. */
const LABEL: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  // Named in the design word for word: a board that is not there has to say so,
  // and say that it is still trying (the provider retries on its own).
  load_failed: "This board couldn't be loaded. Retrying…",
};

export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      role="status"
      data-state={state}
      data-testid="connection-status"
    >
      {LABEL[state]}
    </div>
  );
}
