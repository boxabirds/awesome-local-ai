/**
 * "Does this board exist?" as a hook (story 5, task 1.3).
 *
 * A board link is opened by typing or pasting, and the room behind it may be
 * real, missing, or momentarily unreachable. The page must not open a provider
 * on a board that is not there (`live.no_fork`: a wrong link is not a new
 * session), and it must not treat a failed *request* as a missing board.
 *
 * The rule, and where the constants come from:
 *
 *  - one check on mount; a `200` means "show the board", a `404` means "Board
 *    not found";
 *  - an `unavailable` (offline / 5xx / a thrown fetch) says nothing about the
 *    board, so it is retried with a doubling backoff starting at
 *    `BOARD_CHECK_RETRY_BASE_MS` and capped at `RECONNECT_MAX_BACKOFF_MS` — the
 *    same ceiling story 3's provider uses, so a link check and a socket retry
 *    feel alike. It never turns into "Board not found": the service coming
 *    back must open the board without a reload (`share.unreachable`);
 *  - everything stops when the board changes or the page unmounts, so a slow
 *    answer cannot write to a page that has moved on.
 *
 * The checker and the timers are injectable so the timing rules are testable
 * in jsdom without a network or real seconds (TC-19 to TC-21).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard, type BoardCheck, type FetchImpl } from './api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../shared/config';

/** What the board page should be showing right now. */
export type BoardStatus =
  | { phase: 'loading'; retried: boolean }
  | { phase: 'found' }
  | { phase: 'not_found' };

export interface BoardExistsOptions {
  /** The checker. Defaults to the real {@link checkBoard}; tests stub it. */
  check?: (boardId: string, fetchImpl?: FetchImpl) => Promise<BoardCheck>;
  /** A fetch seam handed to the default checker. */
  fetchImpl?: FetchImpl;
  /** Scheduling seams for tests that control the clock. */
  delay?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearDelay?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** What the hook reports. */
export interface BoardExists {
  status: BoardStatus;
}

/**
 * Ask whether a board exists, and keep asking while the answer is "I could not
 * ask". The returned phase is the only thing the board page renders on.
 */
export function useBoardExists(
  boardId: string | null,
  options: BoardExistsOptions = {},
): BoardExists {
  const {
    check = checkBoard,
    fetchImpl,
    delay = (callback, ms) => setTimeout(callback, ms),
    clearDelay = (handle) => clearTimeout(handle),
  } = options;

  const [status, setStatus] = useState<BoardStatus>(() =>
    boardId === null ? { phase: 'not_found' } : { phase: 'loading', retried: false },
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearDelay(timer.current);
      timer.current = null;
    }
  }, [clearDelay]);

  useEffect(() => {
    if (boardId === null) {
      setStatus({ phase: 'not_found' });
      return;
    }
    // A new board starts the backoff from scratch.
    stop();
    attempt.current = 0;
    setStatus({ phase: 'loading', retried: false });

    let cancelled = false;

    /** Ask once, then either settle or schedule the next try. */
    const run = async (): Promise<void> => {
      if (cancelled) return;
      const outcome = await check(boardId, fetchImpl);
      if (cancelled) return;
      if (outcome.status === 'exists') {
        setStatus({ phase: 'found' });
        return;
      }
      if (outcome.status === 'not_found') {
        setStatus({ phase: 'not_found' });
        return;
      }
      attempt.current += 1;
      const backoff = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** (attempt.current - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      setStatus({ phase: 'loading', retried: true });
      timer.current = delay(() => void run(), backoff);
    };

    void run();
    return () => {
      cancelled = true;
      stop();
    };
    // `boardId` is the only trigger; the seams are stable within a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return { status };
}
