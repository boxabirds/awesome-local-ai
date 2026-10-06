/**
 * Board page state (`share.board_page`, `share.not_found`, `share.unreachable`).
 *
 * A board link goes through a decision before any board content appears: *does
 * this board exist?* The four phases are the answers that decision can reach,
 * and this file is the only place that says which event moves between them —
 * component tests assert transitions by calling `nextBoardPageState` directly.
 *
 *   checking    the page asked, and is waiting for the answer
 *   board       the board exists: show the board
 *   not_found   the server said there is no such board (or the link is not a
 *               board address at all): show the guidance page, connect nothing
 *   unreachable the question could not be asked: say so, and ask again later
 *
 * The shape that keeps `share.not_found` honest is that "what to render" is read
 * out of `phase`. Anything rendering board content has to look at `phase`, so an
 * unknown link cannot leak a board screen just because it has a `boardId`.
 */

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from "../../shared/config";

export type BoardPagePhase = "checking" | "board" | "not_found" | "unreachable";

export interface BoardPageState {
  phase: BoardPagePhase;
  /** The address this page was opened at, malformed or not. */
  boardId: string;
  /** How many existence checks have failed in a row (drives the retry backoff). */
  failedChecks: number;
  /** How long to wait before the next check, when the last one could not be made. */
  retryDelayMs: number;
}

export type BoardPageEvent =
  | { type: "checked"; outcome: "exists" | "not_found" }
  | { type: "check-failed" }
  | { type: "recheck" };

/** Opening a link always starts by asking. */
export function initialBoardPageState(boardId: string): BoardPageState {
  return { phase: "checking", boardId, failedChecks: 0, retryDelayMs: 0 };
}

/**
 * Exponential retry: 1 s, 2 s, 4 s, … capped at `RECONNECT_MAX_BACKOFF_MS` —
 * the same backoff already used for reconnecting, and the same starting point as
 * reconnect backoff (`BOARD_CHECK_RETRY_BASE_MS`).
 */
export function boardCheckRetryDelayMs(failedChecks: number): number {
  const uncapped = BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, failedChecks - 1);
  return Math.min(uncapped, RECONNECT_MAX_BACKOFF_MS);
}

/**
 * The transition table.
 *
 * Every phase is reachable from `checking`, and the only way back into
 * `checking` is `recheck` — the timer the unreachable phase sets. A check that
 * succeeds clears the failure count, so the next outage starts again at 1 s.
 */
export function nextBoardPageState(state: BoardPageState, event: BoardPageEvent): BoardPageState {
  switch (event.type) {
    case "checked": {
      if (event.outcome === "exists") {
        return { ...state, phase: "board", failedChecks: 0, retryDelayMs: 0 };
      }
      return { ...state, phase: "not_found", failedChecks: 0, retryDelayMs: 0 };
    }

    case "check-failed": {
      const failedChecks = state.failedChecks + 1;
      return {
        ...state,
        phase: "unreachable",
        failedChecks,
        retryDelayMs: boardCheckRetryDelayMs(failedChecks),
      };
    }

    case "recheck":
      // Only a page that is waiting to ask again moves here; a board page or a
      // not-found page does not re-ask underneath the person.
      if (state.phase !== "unreachable") return state;
      return { ...state, phase: "checking" };

    default:
      return state;
  }
}
