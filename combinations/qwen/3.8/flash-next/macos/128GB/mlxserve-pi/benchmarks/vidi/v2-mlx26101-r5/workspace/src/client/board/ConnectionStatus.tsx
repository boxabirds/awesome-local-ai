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
 * `role="status"` makes the text an ARIA live region, so a screen reader announces a
 * connection that drops and comes back without anybody asking. The board stays
 * editable in every state: being offline is not a reason to stop somebody typing.
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
