/**
 * The page state machines (design "Home, board and not-found pages").
 *
 * Pure functions, because these are the decisions the story is actually about: whether
 * a person who pressed a button is waiting, failed or on their way to a board, and
 * whether a person who opened a link is looking at a board, a board that is not there,
 * or a service that has not answered yet. Rendering is a separate concern and is tested
 * separately; these are tested on their own so the transitions are checked without a
 * DOM in the way.
 */

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.js';
import type { CheckResponse, CreateResponse } from '../api.js';

/** What the home page is doing about making a board. */
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

/** What the board page is doing about opening a link. */
export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  /**
   * The service did not answer. `attempt` is how many times it has failed to answer in
   * a row, and `nextRetryMs` is how long the page will wait before asking it again —
   * which is the same exponential backoff the socket uses, capped at the same ceiling,
   * so the app has one idea about how often to retry and not two.
   */
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** PRD `share.create_failure`: the exact words the home page shows. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/** PRD `share.open_link`: what the board page says while the link is being checked. */
export const OPENING_BOARD_MESSAGE = 'Opening board…';

/** PRD `share.unreachable`: what the board page says when the service is not answering. */
export const UNREACHABLE_MESSAGE = "Couldn't reach vidi6. Retrying…";

/** PRD `share.not_found`: the heading of the page an unknown link gets. */
export const NOT_FOUND_HEADING = 'Board not found';

/** PRD `share.not_found`: what that page tells the person to do. */
export const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';

/**
 * How long to wait before link check number `attempt` (1 for the first failure).
 * 1 s, 2 s, 4 s … up to {@link RECONNECT_MAX_BACKOFF_MS}, and never 0: a service that
 * is down is not helped by being asked again in the same millisecond.
 */
export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  // `2 ** 40` is a float, not an overflow risk, but the cap is applied after the
  // multiplication so a huge attempt number cannot produce Infinity.
  const delay = BOARD_CHECK_RETRY_BASE_MS * Math.min(2 ** exponent, RECONNECT_MAX_BACKOFF_MS);
  return Math.min(delay, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The home page's one transition table: pressing **New board** starts a creation, and
 * the answer either sends the person to a board (the page navigates, which is why a
 * `created` answer leaves the state back at `idle`) or says the creation failed.
 *
 * An answer to a press that is not in flight changes nothing. The page can be handed
 * the answer to a creation the person has since left behind — the home page opened
 * again while one was still on its way, say — and putting a failure message on screen
 * for a click that is no longer on screen is a bug dressed as a feature.
 */
export function nextHomePageState(state: HomePageState, result: CreateResponse): HomePageState {
  if (state.kind !== 'creating') return state;
  if (result.kind === 'created') return { kind: 'idle' };
  return { kind: 'create_failed', message: CREATE_FAILED_MESSAGE };
}

/** What state a page starts in when it is opened at a board id. */
export const initialBoardPageState = (): BoardPageState => ({ kind: 'checking' });

/**
 * What the board page does with a link check.
 *
 * `exists` opens the board — full editing, no sign-in, and the socket is opened by
 * that transition and not before it, because a connection to a board that is not there
 * is a 404 and a badge that says "Reconnecting…" instead of "Board not found".
 *
 * `not_found` and `ready` are both final, for opposite reasons. A board that is not
 * there is not asked about again, because asking again is a way to end up with a board
 * nobody meant to create; a board that *is* open is not taken away, because from then
 * on the socket's own connection state is what tells the person about the service, and
 * a page that pulled a board out from under someone because a late answer arrived
 * would be worse than the failure it was reacting to.
 *
 * `unreachable` is final about nothing: it keeps counting, the wait grows, and the
 * message does not change.
 *
 * `attempt` is the number of failures *including* this one, so the first failure of a
 * freshly opened link is attempt 1.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  if (state.kind === 'ready' || state.kind === 'not_found') return state;

  const failures = Math.max(1, attempt);
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable':
      return { kind: 'unreachable', attempt: failures, nextRetryMs: retryDelayMs(failures) };
  }
}
