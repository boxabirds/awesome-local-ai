/**
 * Page state machines for story 5 (`share.pages`).
 *
 * The Home page and the Board page are the two places a person can get stuck, so
 * their states are modelled as data with the exact PRD copy attached, and the
 * Board page's transition is a pure function — every edge of the design's state
 * diagram is reachable in a unit test, without a fetch or a timer.
 */

import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import type { CheckResponse } from '../api';

/** The one sentence shown when creating fails (PRD `share.create_failure`). */
export const CREATE_FAILED_MESSAGE = "Couldn't create a board. Please try again." as const;

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: typeof CREATE_FAILED_MESSAGE };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

/**
 * The retry interval for the `attempt`-th failed check (1-indexed): exponential
 * from {@link BOARD_CHECK_RETRY_BASE_MS}, capped at {@link RECONNECT_MAX_BACKOFF_MS}.
 */
export function boardCheckRetryMs(attempt: number): number {
  const scaled = BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(scaled, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The next board-page state given a check result.
 *
 * `attempt` is the number of checks made so far (the first is 1), so an
 * unreachable result carries how long to wait before the next try. `exists` and
 * `not_found` are terminal for the current address; only `unreachable` schedules
 * another attempt. `boardId` fills in the `ready` state (the caller knows the id
 * from the route; the reducer only decides the kind and the timing).
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId = '',
): BoardPageState {
  if (result.kind === 'exists') return { kind: 'ready', boardId };
  if (result.kind === 'not_found') return { kind: 'not_found' };
  return { kind: 'unreachable', attempt, nextRetryMs: boardCheckRetryMs(attempt) };
}
