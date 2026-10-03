/**
 * The page states as data, with the transitions kept separate from the components that
 * render them.
 *
 * The two pages of this story are small, but each one is a sequence a person can watch:
 * press, wait, then arrive somewhere. Keeping the sequences as pure functions means the
 * interesting parts — "a failed check retries with a doubled wait", "the second press
 * while creating does nothing", "a server-side not-found wins over what the link looked
 * like" — are stated once, and the components below only say how a state looks.
 */
import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

/** The home page: a button, and what happened when it was pressed. */
export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: string };

/** The message the PRD specifies for a creation that did not happen. */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again.";

/**
 * The board page, from the link in the address bar to a board on screen.
 *
 * `checking` and `unreachable` both carry how the page got here because the page has to
 * say it: "Opening board…" while the first answer is outstanding, "Couldn't reach vidi6.
 * Retrying…" while it waits to ask again. `not_found` carries nothing, because there is
 * nothing left to say — the NotFoundPage does the explaining.
 */
export type BoardPageState =
  | { kind: 'checking'; boardId: string }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/** How long the page waits after `attempt` failed checks: 1s, 2s, 4s, capped. */
export function boardCheckRetryMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** exponent, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * What the board page becomes after a check.
 *
 * `state` is what the page was showing, `result` what the server said, `attempt` how many
 * checks this address has had including this one, and `boardId` the address the page is
 * about — the id travels with the answer rather than being looked up later, so a `ready`
 * state can never name a board other than the one that was just confirmed.
 */
export function nextBoardPageState(
  state: BoardPageState,
  result: CheckResponse['kind'],
  attempt: number,
  boardId: string,
): BoardPageState {
  switch (result) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      // The count only ever goes up. A retry that somehow reports a smaller attempt than
      // the wait already promised would shorten the wait, which is the one thing backoff
      // must not do.
      const counted = state.kind === 'unreachable' ? Math.max(attempt, state.attempt + 1) : attempt;
      return { kind: 'unreachable', attempt: counted, nextRetryMs: boardCheckRetryMs(counted) };
    }
  }
}
