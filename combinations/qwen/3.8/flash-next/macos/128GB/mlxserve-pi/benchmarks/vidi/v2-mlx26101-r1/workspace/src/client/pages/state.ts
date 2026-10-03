// The page-level state for story 5, as plain values so the interesting parts can be
// tested without a browser: what the home page's button is doing, and what the board
// page decided after asking whether its link exists.
//
// The rule these states encode (share.not_found): a board is reported missing only
// when the service said 404. Anything we could not ask about is `unreachable`, which
// retries on the same doubling cadence the live connection uses.

import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import type { CheckResponse } from '../api';

/** What the home page's New board button is doing. */
export type HomePageState =
  | { kind: 'idle' }
  /** The request is in flight; the button says "Creating…" and cannot fire twice. */
  | { kind: 'creating' }
  /** Creation failed, or the service could not be reached. */
  | { kind: 'create_failed'; message: string };

/** What the board page shows for the link in the address bar. */
export type BoardPageState =
  /** "Opening board…" — the first answer has not arrived yet. */
  | { kind: 'checking' }
  /** The board exists: mount the board and connect to it. */
  | { kind: 'ready'; boardId: string }
  /** The service said this board does not exist. */
  | { kind: 'not_found' }
  /**
   * We could not ask. `attempt` counts the failures so far, `nextRetryMs` is how
   * long to wait before asking again.
   */
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * How long to wait after the `attempt`-th failed check: the base delay doubling
 * each time (1s, 2s, 4s …), capped at the same ceiling the live connection backs
 * off to. Exported because the page schedules from `nextRetryMs` and the tests
 * assert the cadence.
 */
export function checkRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(
    BOARD_CHECK_RETRY_BASE_MS * 2 ** exponent,
    RECONNECT_MAX_BACKOFF_MS,
  );
}

/**
 * The next board-page state after a check.
 *
 * `attempt` is how many checks have now come back for this link, counting this one.
 * `boardId` is only needed for the `exists` answer (the state carries it so the page
 * can mount the board); every other outcome ignores it.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId = '',
): BoardPageState {
  if (result.kind === 'exists') return { kind: 'ready', boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  // An answer we could not get does not undo a definitive one: once this link has
  // been answered (the board is there, or it is not), a later failure to ask changes
  // the page not at all — the live board owns the connection from there.
  if (state.kind === 'ready' || state.kind === 'not_found') return state;
  return {
    kind: 'unreachable',
    attempt,
    nextRetryMs: checkRetryDelayMs(attempt),
  };
}
