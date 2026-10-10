import type { ConnectionState } from './connectBoard';

/**
 * The connection badge (anchor `live.status`).
 *
 * It is a live region, so its text is announced when it changes, and it renders
 * in every state — empty when there is nothing to report — so there is always
 * one place to look for the connection.
 *
 *   connecting   "Connecting…"    the room has not answered this client yet
 *   reconnecting "Reconnecting…"  a link that worked is down; the board works on
 *   confirmed    "Connected"      a lost link came back (hidden again after
 *                                 CONNECTED_CONFIRMATION_MS by the connection)
 *   connected    (nothing)        the normal state
 *   load_failed  "This board couldn't be loaded. Retrying…" - shown in red,
 *                                 and the board is not editable (`persist.client_status`)
 *
 * The board is never dimmed, covered, or disabled while the link is down: an
 * outage costs the person nothing but the badge (`live.status`). The one
 * exception is `load_failed`, where the board would only be shown as a lie.
 */

const TEXT: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  connected: '',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/**
 * How a state is meant to read. `styles.css` paints `danger` in red; the tone is
 * on the element so a test can tell "this is a failure" from "this is only a
 * pause" without measuring a colour.
 */
const TONE: Record<ConnectionState, string> = {
  connecting: 'info',
  reconnecting: 'warning',
  confirmed: 'success',
  connected: 'none',
  load_failed: 'danger',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  return (
    <div
      className={`connection-status connection-status--${state}`}
      data-testid="connection-status"
      data-connection-state={state}
      data-tone={TONE[state]}
      role="status"
      aria-live="polite"
    >
      {TEXT[state]}
    </div>
  );
}
