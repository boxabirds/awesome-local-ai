// The connection status line. A live region so assistive tech announces
// connection changes without stealing focus. Hidden while stably connected.

import {
  type ConnectionState,
  type ConnectionStatusValue,
} from './useConnectionBadge.ts';

export type { ConnectionState, ConnectionStatusValue };

export interface AriaAttrs {
  role: 'status' | 'alert';
  'aria-live': 'polite' | 'assertive';
}

/**
 * Map a connection status to its ARIA attributes. Everything is a polite live
 * region (a status line, not an interrupting alert).
 */
export function statusToRole(_status: ConnectionStatusValue): AriaAttrs {
  return { role: 'status', 'aria-live': 'polite' };
}

/** The colour of the load-failure sentence: a red, not the amber/grey of a drop. */
export const LOAD_FAILED_TEXT_COLOR = '#b3261e';

/** Human-readable, screen-reader-announced label for each visible status. */
export function connectionLabel(status: ConnectionStatusValue): string {
  switch (status) {
    case 'confirmed':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'load_failed':
      return "This board couldn't be loaded. Retrying…";
    case 'connecting':
    default:
      return 'Connecting…';
  }
}

export interface ConnectionStatusProps {
  status: ConnectionStatusValue;
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  // A stably-connected board shows no badge.
  if (status === 'connected') return null;
  const aria = statusToRole(status);
  return (
    <div
      className="connection-status"
      data-testid="connection-status"
      data-status={status}
      role={aria.role}
      aria-live={aria['aria-live']}
      style={status === 'load_failed' ? { color: LOAD_FAILED_TEXT_COLOR } : undefined}
    >
      {connectionLabel(status)}
    </div>
  );
}
