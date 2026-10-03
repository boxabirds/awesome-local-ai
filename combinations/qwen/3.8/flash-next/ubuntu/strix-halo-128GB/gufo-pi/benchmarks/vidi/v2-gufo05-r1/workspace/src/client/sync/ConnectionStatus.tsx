/**
 * The connection badge: one line at the top centre of the board that says what
 * the connection is doing, and otherwise stays out of the way.
 *
 * Four states, three messages and one absence:
 *
 * - `connecting` — the first load, before the boards have synced: "Connecting…".
 * - `connected` — in sync: nothing is rendered at all, because a connection that
 *   works is not information.
 * - `reconnecting` — amber: the connection was lost, the board still works and
 *   what is typed here will go out when it returns.
 * - `confirmed` — green, for CONNECTED_CONFIRMATION_MS after a reconnection: the
 *   catch-up happened, and then the badge hides itself.
 * - `load_failed` — red, and it stays: the server would not hand over this board, so
 *   the board is showing nothing real and cannot be edited (`canEdit`). It is the one
 *   message that is not about the connection coming back, so it does not time out.
 *
 * It is a `role="status"` live region, so a screen reader hears the connection
 * change without the board losing focus, and it never takes a click: the note
 * underneath it is still a note.
 */
import type { ConnectionState } from './connectBoard';

/**
 * May this board write to its document?
 *
 * `canEdit` sits with the badge because the badge is where these states are explained,
 * and this is the one decision they drive that reaches beyond it: every editing handler
 * on the board asks before it writes.
 *
 * Everything except a board the server would not load. In every other state the local
 * document is the real one, and what is typed while the connection is down goes out
 * with the next sync (`live.catch_up`); on a board that failed to load there is no such
 * document, and anything written here would be discarded — so the board refuses the
 * gestures that would write, while still letting the person select and look
 * (`TC-25`, and story 4's TC-23).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export const CONNECTION_STATUS_TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting\u2026',
  reconnecting: 'Reconnecting\u2026',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying\u2026",
};

export interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;
  return (
    // `pointerEvents: none` is set here as well as in the stylesheet: "the badge never
    // takes a click that belongs to the note underneath it" is a behaviour, and a
    // behaviour a test asserts should not depend on which files that test loads.
    <div
      className={`connection-status connection-status--${state}`}
      style={{ pointerEvents: 'none' }}
      role="status"
      data-state={state}
      data-testid="connection-status"
    >
      {CONNECTION_STATUS_TEXT[state]}
    </div>
  );
}
