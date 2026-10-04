import { BOARD_CHECK_RETRY_BASE_MS } from '../../shared/config';
import type { CheckOutcome } from '../api';

/**
 * What a page knows, and what it does next.
 *
 * Both pages of story 5 spend their lives waiting for one answer from the service, and both are
 * easier to trust - and easier to test - with that waiting written down somewhere that renders
 * nothing. What is here is the whole of both: two small state machines and the retry schedule,
 * with no React and no `fetch` in sight. The pages decide nothing on their own; they hand over
 * what just happened and show what they are told to.
 *
 * The shape worth noticing is that an *unknown* is a state of its own. A check that could not get
 * an answer says so and keeps asking; a check that was told "no board here" stops asking, because
 * that is an answer and asking again would only ask the same question of a thing that has already
 * replied.
 */

/** Where the page that a board link leads to is. */
export type BoardPageState =
  /** Waiting for the one answer this page exists to get. */
  | 'checking'
  /** There is a board here: the board itself is shown. */
  | 'ready'
  /** There is no board here, and the service is not unsure about it. */
  | 'absent'
  /** Nothing could be reached. Not a verdict about the board - about the way to it. */
  | 'unreachable'
  /** An answer that was none of the above, or none after trying. */
  | 'error';

/** The page, plus how many times this page has asked and not got through. */
export interface BoardPage {
  readonly state: BoardPageState;
  /** Checks that could not be completed, in this visit to this address. */
  readonly attempts: number;
}

/** The first thing the page is: asking. */
export function boardPage(): BoardPage {
  return { state: 'checking', attempts: 0 };
}

/**
 * How many times one visit will ask before it stops and blames itself.
 *
 * Six, which with the schedule below is about half a minute of trying. It is not a timeout chosen
 * to be polite to the service - it is the point after which "I cannot get there" has been said
 * enough times to be worth saying once more with a button next to it.
 */
export const BOARD_CHECK_MAX_ATTEMPTS = 6;

/** The longest a page will make anybody wait between two checks. */
export const BOARD_CHECK_RETRY_MAX_MS = 30_000;

/**
 * How long to wait before check number `attempts + 1`: the base doubled once per attempt, which
 * is what the PRD's "exponential backoff, capped at 30 s" says, stopped from growing past a
 * person's patience.
 */
export function retryDelayFor(attempts: number): number {
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), BOARD_CHECK_RETRY_MAX_MS);
}

/**
 * The page after an answer came back - or failed to.
 *
 * `found` and `not-found` are both endings: one shows a board, the other says there is none, and
 * neither asks again. `unreachable` is the only state that keeps going, because it is not a
 * verdict about the board - and `failed` stops at once, because a service that answers "something
 * went wrong" has answered, and a page that retried that would be arguing with it.
 */
export function pageAfter(page: BoardPage, outcome: CheckOutcome): BoardPage {
  switch (outcome) {
    case 'found':
      return { state: 'ready', attempts: 0 };
    case 'not-found':
      return { state: 'absent', attempts: page.attempts };
    case 'failed':
      return { state: 'error', attempts: page.attempts };
    case 'unreachable': {
      const attempts = page.attempts + 1;
      return {
        state: attempts >= BOARD_CHECK_MAX_ATTEMPTS ? 'error' : 'unreachable',
        attempts,
      };
    }
  }
}

/** Whether this page should ask the service again, and when. */
export function pageWantsRetry(page: BoardPage): boolean {
  return page.state === 'unreachable';
}

/** Back from "something went wrong": the person pressed Try again. */
export function pageRetrying(page: BoardPage): BoardPage {
  return { state: 'checking', attempts: page.attempts };
}

/** What the page that a board link leads to is showing, in the words the product chose. */
export const BOARD_PAGE_TEXT: Record<Exclude<BoardPageState, 'ready'>, string> = {
  checking: 'Opening board…',
  absent: 'Board not found',
  unreachable: "Couldn't reach vidi6. Retrying…",
  error: 'Something went wrong',
};

/** What the home page is doing. */
export type HomePageState =
  /** Showing the button. */
  | 'idle'
  /** Asked for a board, and waiting: the button is not to be pressed twice. */
  | 'creating'
  /** Asked, and did not get one. The button works again, and says why. */
  | 'failed';

/** The home page's button: `start` is a click, the others are what came of it. */
export type HomeAction = 'start' | 'created' | 'failed';

/**
 * The home page after a click, or after the answer to one.
 *
 * `creating` ignores `start`: that one line is the whole of "double-clicking New board makes one
 * board, not two", which is why it is worth having a function instead of a boolean in the
 * component.
 */
export function homeAfter(state: HomePageState, action: HomeAction): HomePageState {
  switch (action) {
    // A click while a board is already on its way is the same click: `creating` either way, so a
    // double-click cannot ask for two boards.
    case 'start':
      return 'creating';
    case 'created':
      return 'idle';
    case 'failed':
      return state === 'creating' ? 'failed' : state;
  }
}

/** Whether the button should be sitting out the wait. */
export function homeBusy(state: HomePageState): boolean {
  return state === 'creating';
}

/** What the home page says when a board could not be started. */
export const HOME_FAILURE = "Couldn't create a board. Please try again.";
