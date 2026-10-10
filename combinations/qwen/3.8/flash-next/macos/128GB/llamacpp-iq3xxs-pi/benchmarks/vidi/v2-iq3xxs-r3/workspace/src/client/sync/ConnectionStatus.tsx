import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard';

/**
 * The connection badge (live.status): top centre, hidden while everything is
 * normal. Its whole contract is the text and the colour of one state — the
 * board behind it is never disabled by it, in any state.
 */
export interface ConnectionStatusProps {
  readonly state: ConnectionState;
}

/** The only text the user sees per state; `connected` shows nothing at all. */
const LABEL: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
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
