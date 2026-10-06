/**
 * The connection status badge (story 3, extended by story 4).
 *
 * A single element at the top centre of the board that says what the connection is doing, and
 * is out of the way the rest of the time:
 *
 *   connecting    "Connecting…"                          only while the board is loading for the first time
 *   reconnecting  "Reconnecting…"                        amber, from the moment the link drops
 *   confirmed     "Connected"                            green, for CONNECTED_CONFIRMATION_MS after a return
 *   load_failed   "This board couldn't be loaded. …"     red: the board is read-only until a sync works
 *   connected     nothing                                the normal state needs no badge
 *
 * The text is only ever swapped inside the same `role="status"` element, which is what makes a
 * screen reader announce the change.
 *
 * The load-failure message says what is wrong, what is happening about it, and - by the colour and
 * by the board refusing edits - what not to do in the meantime. It does not apologise, and it does
 * not blame the person, because neither is true: the room could not read the board and is retrying.
 */
import type { ConnectionState } from './connectBoard';

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
  connected: '',
};

export function ConnectionStatus(props: { state: ConnectionState }) {
  const label = LABELS[props.state];
  if (label === '') return null;
  return (
    <div
      className={`connection-status connection-status--${props.state}`}
      data-state={props.state}
      data-testid="connection-status"
      role="status"
    >
      {label}
    </div>
  );
}
