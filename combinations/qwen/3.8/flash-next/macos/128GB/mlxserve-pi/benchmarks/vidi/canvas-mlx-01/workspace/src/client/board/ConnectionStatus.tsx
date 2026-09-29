/**
 * The connection status badge (`ConnectionStatus`). Renders a label in `.test-connection-status`
 * — exactly one state at a time (a test asserts the wrong label is absent, never merely
 * hidden) — an optional peer count, and an optional inline message for the invalid-board-id
 * / offline case.
 */
import { formatConnectionStatusLabel, type ConnectionStatus } from './connectBoard.js';

/** The load-failure badge is drawn in red (PRD: an honest, unmissable failure colour). */
export const LOAD_FAILED_COLOR = '#c62828';

export interface ConnectionStatusProps {
  status: ConnectionStatus;
  /** Shown next to the label for the invalid-board-id / offline case. */
  message?: string;
  /** Other editors present; when > 0 the badge reports "· N" (the advisory count). */
  peers?: number;
}

export function ConnectionStatus({
  status,
  message,
  peers,
}: ConnectionStatusProps): React.JSX.Element {
  return (
    <span
      className="board-connection test-connection-status"
      role="status"
      data-status={status}
      data-peers={peers ?? undefined}
      style={status === 'load_failed' ? { color: LOAD_FAILED_COLOR } : undefined}
    >
      {formatConnectionStatusLabel(status)}
      {peers !== undefined && peers > 0 ? (
        <span className="test-peer-count">{` · ${peers}`}</span>
      ) : null}
      {message !== undefined && (
        <span className="board-connection__message test-connection-message">{message}</span>
      )}
    </span>
  );
}
