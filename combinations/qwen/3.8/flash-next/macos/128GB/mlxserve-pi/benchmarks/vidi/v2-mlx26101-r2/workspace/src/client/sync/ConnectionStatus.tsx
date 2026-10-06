import type { JSX } from 'react';

import type { ConnectionState } from './connectBoard.js';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * What each state says. A board that is in step with its room shows nothing:
 * `connected` is the state the user should never see.
 *
 * The last one is longer than the others on purpose. "Reconnecting…" asks for
 * patience, which is the right thing to ask for when the room is merely out of
 * reach; a board that could not be opened has to say what happened to it, and
 * that the page is still trying, in the same breath - otherwise the reader has
 * to guess whether to wait or to go.
 */
export const CONNECTION_STATUS_TEXTS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/**
 * The connection badge (design "connection-status"): top centre, announced to a
 * screen reader as a live region, amber while the room cannot be reached, green
 * for the moment the connection comes back, and red when the room has said it
 * cannot open this board.
 *
 * Red is not decoration: amber means wait, red means what you are doing is not
 * going anywhere, and the board is locked in the red case only. A reader who is
 * told "Reconnecting…" while the interface refuses to make a note is being told
 * something the interface contradicts.
 *
 * It takes `pointer-events: none` (styles.css) — a badge must never swallow a
 * click, a drag or a pinch from the board, and it never covers a control: the
 * toolbar is on the left edge and the zoom controls in the bottom-right corner.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  if (state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-state={state}
      role="status"
    >
      {CONNECTION_STATUS_TEXTS[state]}
    </div>
  );
}
