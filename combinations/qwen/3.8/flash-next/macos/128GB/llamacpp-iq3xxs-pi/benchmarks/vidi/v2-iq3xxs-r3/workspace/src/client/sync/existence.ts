/**
 * Asking whether a link leads to a board, and asking again when it cannot be
 * answered (share.open_link, share.not_found).
 *
 * The page cannot connect to a board before it knows the board is there: a
 * websocket to a room that does not exist would be the app's first hint to
 * somebody else that their link is wrong, and it would be a wrong hint — the
 * room would have to answer the question twice. So the check comes first, and
 * only then does `BoardSession` mount and open `/api/rooms/<id>`.
 *
 * What separates "this link is wrong" from "I could not tell" is the answer, not
 * the status code: a 404 is a board's absence, and it is shown as such. A 500, or
 * a fetch that never came back, says nothing about the board, so it is retried and
 * said out loud as the failure it is.
 */
import { useEffect, useState } from 'react';

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { BoardAnswer } from '../api';

/** How a page asks. Injected so a component test can answer on a schedule. */
export type ExistenceCheck = (boardId: string) => Promise<BoardAnswer>;

/** Where the check got to. Each one is a page the user can read. */
export type ExistencePhase = 'checking' | 'ready' | 'missing' | 'unreachable';

export interface Existence {
  readonly phase: ExistencePhase;
  /** Checks made so far, including the one in flight. */
  readonly attempts: number;
  /** Ask again right now, ignoring the schedule (the error state's button). */
  readonly retry: () => void;
}

/**
 * How long the page waits *after* attempt `attempt` before it asks again:
 * 1s, 2s, 4s … up to the same cap the reconnect uses, so a page that has been
 * sitting on a bad link for a minute asks about as often as a board that has
 * been sitting offline (TC-21).
 */
export function existenceRetryDelay(attempt: number): number {
  if (attempt < 1) throw new RangeError(`attempt counts from 1, got ${attempt}`);
  return Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_BACKOFF_MS);
}

function phaseOf(answer: BoardAnswer): ExistencePhase {
  if (answer === 'exists') return 'ready';
  return answer; // 'missing' | 'unreachable'
}

/**
 * Check once when the board changes, and keep checking while the answer is "I
 * could not tell": a page sitting on an unreachable service is still hoping, and
 * the wait between attempts doubles up to a cap (TC-21).
 *
 * A definite answer ends the asking, either way. A "yes" opens the board; a "no"
 * is the not-found page, and boards are never deleted, so a second read of an
 * address the server has already refused could not change the page — and every
 * extra read would be a request that tells the server nothing new.
 */
export function useBoardExistence(boardId: string, check: ExistenceCheck): Existence {
  const [state, setState] = useState<{ attempts: number; phase: ExistencePhase }>({
    attempts: 0,
    phase: 'checking',
  });
  // Bumped by the Retry button: the effect below restarts, timers and all.
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let stopped = false;
    let waiting: ReturnType<typeof setTimeout> | undefined;

    const ask = async (attempt: number): Promise<void> => {
      const answer = await check(boardId);
      if (stopped) return; // the board changed, or the page went away
      setState({ attempts: attempt, phase: phaseOf(answer) });
      if (answer !== 'unreachable') return;
      waiting = setTimeout(() => void ask(attempt + 1), existenceRetryDelay(attempt));
    };

    void ask(1);
    return () => {
      stopped = true;
      if (waiting !== undefined) clearTimeout(waiting);
    };
  }, [boardId, check, asked]);

  return {
    ...state,
    retry(): void {
      setAsked((n) => n + 1);
    },
  };
}
