/**
 * The pages' state machines, with the timers left out.
 *
 * Both pages have a small number of states and a decision in each one about what to say when the
 * service does not answer, and those decisions are the part worth testing on their own: they are
 * where "the request failed" becomes either "there is no board here" or "I could not find out", and
 * the two look nothing alike to the person in front of the screen. The components below hold the
 * clock and the fetch; these functions say what a reply means.
 */
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

/** What the home page says when a board could not be made. Copy from the PRD, word for word. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/**
 * The home page: one button, and what it is doing.
 *
 * There is no failed-with-a-board state: a click either makes a board and goes to it, or leaves the
 * person exactly where they were with a message that says to try again.
 */
export type HomePageState = { kind: 'idle' } | { kind: 'creating' } | { kind: 'create_failed'; message: string };

/**
 * The board page, which is the page that has to be careful: it is the one a person arrives on from
 * a link somebody typed or truncated.
 *
 * Every state names the board it is about, because `ready` cannot be reached without knowing which
 * board became ready, and because a page that is showing a board must be able to tell whether an
 * answer that just came in is about the board it is showing or about the one the address said before
 * the person navigated.
 */
export type BoardPageState =
  | { kind: 'checking'; boardId: string }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  // `attempt` counts the checks that have failed, this one included, and `nextRetryMs` is how long
  // to wait before the next. Both are in the state rather than hidden in a closure because the
  // message is a promise about the future — "Retrying…" — and a page that makes one should be able
  // to say when it intends to keep it.
  | { kind: 'unreachable'; boardId: string; attempt: number; nextRetryMs: number };

/**
 * How long to wait before check number `attempt` (the first failed check being 1).
 *
 * The same shape the board connection's retries use — double the wait, up to a ceiling — because
 * from the person's side of it these are the same problem: the service is not answering, and the
 * app will keep asking without asking to be told to.
 */
export function boardCheckDelay(attempt: number): number {
  const doubled = BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(doubled, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * What a reply about a board means.
 *
 * `attempt` is the number of replies that are now in, including this one: an answer that the service
 * could not be reached for the second time is a different message from the third, in the sense that
 * it should be waited out for twice as long.
 *
 * Only a 404 ends the search. Everything else that went wrong keeps the search open, because the
 * cost of saying "there is no board here" when there is one is a person believing their work is
 * gone, and the cost of the opposite is one more line of "Retrying…".
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse,
  attempt: number,
): BoardPageState {
  // A board that is open stays open, and a search that has ended stays ended. Both are reachable
  // the same way: a check that was still in flight answers after a later one already settled the
  // question, and the older answer is not evidence about anything. It also cannot be honoured
  // honestly — a page in either state has stopped asking, so it has no board to open these answers
  // about.
  if (state.kind === 'ready' || state.kind === 'not_found') return state;

  if (result.kind === 'exists') return { kind: 'ready', boardId: state.boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  return {
    kind: 'unreachable',
    boardId: state.boardId,
    attempt,
    nextRetryMs: boardCheckDelay(attempt),
  };
}
