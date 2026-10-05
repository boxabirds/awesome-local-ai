/**
 * What the two pages know (`share.pages`).
 *
 * Both page states are values rather than a bag of booleans, because the interesting
 * statements here are exclusions: the Home page cannot be *creating* and *failed* at once,
 * and a board page that has decided an address is not a board cannot be talked back into
 * checking it (`share.not_found` versus `share.link_stable`). A union says those things to
 * the compiler; four `useState` flags would not.
 *
 * Nothing in this module touches the network, the clock or the DOM. The retry *delay* is
 * computed here because it is a rule about the product, and the timer that uses it lives in
 * `BoardPage`, where the effect that owns the clock also owns clearing it.
 */

import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/** The only words the Home page uses when a board could not be made (`share.create_failure`). */
export const CREATE_FAILURE_MESSAGE = "Couldn't create a board. Please try again.";

/** What the Home page is doing. */
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILURE_MESSAGE };

/** What the board page knows about the address in the bar. */
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  /** `attempt` is how many re-checks have already been waited for; `nextRetryMs` is how
   * long this one waits, so the page can render the wait as fact rather than as a mood. */
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** The API's answers, plus the page's own nudge when a wait is over. */
export type BoardPageResult = CheckResponse | { kind: 'retry' };

/**
 * The state an address starts in.
 *
 * An id that is not 22 base64url characters is not a board, and saying so is worth one
 * fewer request (`share.not_found`) — the same rule the Worker applies, applied before it.
 */
export function initialBoardPageState(id: string): BoardPageState {
  return isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' };
}

/**
 * How long the wait before retry number `attempt` is: `BOARD_CHECK_RETRY_BASE_MS` doubled
 * once per retry already made, stopping at the ceiling the live connection uses. One
 * unreachable service should cost one backoff rhythm, however the app is knocking on it.
 */
export function boardCheckRetryMs(attempt: number): number {
  const doubled = BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, Math.trunc(attempt));
  return Math.min(doubled, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The board page's whole life, as a table.
 *
 * | current       | result        | next                                              |
 * | ------------- | ------------- | --------------------------------------------------- |
 * | `checking`    | `exists`      | `ready` (needs the `id` this page is about)          |
 * | `checking`    | `not_found`   | `not_found`                                         |
 * | `checking`    | `unreachable` | `unreachable`, waiting `boardCheckRetryMs(attempt)`  |
 * | `unreachable` | `retry`       | `checking`                                          |
 * | `ready`       | anything      | `ready`                                             |
 * | `not_found`   | anything      | `not_found`                                         |
 *
 * Three things worth naming, because each has been the cause of a bug somewhere:
 *
 *  - `not_found` and `ready` are final. A board page does not change its mind about an
 *    address while a person is looking at it; the ways out are a new link or a reload.
 *  - an answer that arrives while `unreachable` is on screen is ignored. Nobody is waiting
 *    for it — the request that asked has been replaced by the wait — and letting it through
 *    is how a page flickers between "Board not found" and a board.
 *  - `ready` needs the id. Without one, this function cannot honestly produce a board, so it
 *    leaves the page checking rather than rendering a board at no address.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: BoardPageResult,
  attempt: number,
  id?: string
): BoardPageState {
  switch (state.kind) {
    case 'not_found':
      // Final. A mistyped link stays answered even while an older probe is in flight.
      return state;
    case 'ready':
      // Final, and reached only by a check that said this board exists. Anything that goes
      // wrong afterwards is the connection's story, not the page's (`story 4`).
      return state;
    case 'checking':
      if (result.kind === 'retry') return state; // already checking: one wait is enough
      if (result.kind === 'exists') return id === undefined ? state : { kind: 'ready', boardId: id };
      if (result.kind === 'not_found') return { kind: 'not_found' };
      return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) };
    case 'unreachable':
      // Only the end of a wait moves this one.
      return result.kind === 'retry' ? { kind: 'checking' } : state;
  }
}
