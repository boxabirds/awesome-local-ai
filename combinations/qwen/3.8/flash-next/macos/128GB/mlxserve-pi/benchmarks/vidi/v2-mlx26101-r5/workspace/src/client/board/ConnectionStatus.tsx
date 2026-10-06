import { connectionIsVisible, connectionLabel, type BoardStatus } from './connection';

export interface ConnectionStatusProps {
  /** Where the connection is; the badge is off the screen when it is connected. */
  state: BoardStatus;
}

/**
 * The connection badge, top-right.
 *
 * It says "Connecting…" until the room is reached, "Reconnecting…" in amber while a
 * dropped connection is being retried, and disappears entirely once the board is
 * live — a connection that is working has nothing to say about itself.
 *
 * Red is kept for the one thing red is true for: the room answered "I could not read this
 * board". That is not a line that is being difficult, and the badge says so in the same
 * breath as what is being done about it (retrying), while the board itself stops taking
 * edits — see `canEdit`. A board that is merely offline keeps being editable, because its
 * changes are held and sent again; a board that cannot be read has nowhere safe to put
 * them.
 *
 * `role="status"` makes the text an ARIA live region, so a screen reader announces a
 * connection that drops, comes back, or a board that cannot be read, without anybody
 * asking.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps): React.JSX.Element | null {
  if (!connectionIsVisible(state)) return null;
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-state={state}
      data-testid="connection-status"
      role="status"
    >
      {connectionLabel(state)}
    </div>
  );
}
