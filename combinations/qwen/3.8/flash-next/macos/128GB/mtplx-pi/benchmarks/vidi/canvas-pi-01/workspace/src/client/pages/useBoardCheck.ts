/**
 * Story 5 · the board-existence check (PRD share.open_link / share.unreachable).
 *
 * `BoardPage` needs to know whether an address holds a board before it mounts
 * the board. The rule that makes this hook non-trivial is the difference
 * between *absent* and *unknown*: a `404` is an answer, so the page shows
 * "Board not found" and stops; a network failure or a `5xx` is not an answer,
 * so the page keeps asking.
 *
 * Retrying is exponential from `BOARD_CHECK_RETRY_BASE_MS`, doubling up to
 * `RECONNECT_MAX_BACKOFF_MS` (the story 3 reconnect ceiling). The window the
 * retries create is exactly the one the PRD asks for: a laptop whose Wi-Fi
 * dropped opens the board on its own, with no reload.
 *
 * Timers are cleared on unmount and every result is checked against a
 * generation counter, so an answer to an earlier check can never be applied
 * after the visitor has moved to a different board.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard, type CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type CheckState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export interface BoardCheck {
  state: CheckState;
  /** How many attempts have been made (the tests count these). */
  attempts: number;
}

/** The next backoff interval, in ms, for a given 0-based attempt index. */
export function checkBackoffMs(attempt: number): number {
  const doubled = BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt;
  return Math.min(doubled, RECONNECT_MAX_BACKOFF_MS);
}

/** @param check injectable for the component tests (defaults to `api.ts`) */
export function useBoardCheck(id: string, enabled: boolean, check = checkBoard): BoardCheck {
  const [state, setState] = useState<CheckState>('checking');
  const [attempts, setAttempts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every board change and on unmount: a result that arrives after
  // either is stale and must be dropped.
  const generation = useRef(0);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(
    (attempt: number) => {
      const mine = generation.current;
      setAttempts(attempt + 1);
      void check(id).then((response: CheckResponse) => {
        if (mine !== generation.current) return;
        if (response.kind === 'exists') {
          setState('ready');
          return;
        }
        if (response.kind === 'not_found') {
          setState('not_found');
          return;
        }
        // Unreachable: show the retry message and schedule the next attempt.
        setState('unreachable');
        clearTimer();
        timer.current = setTimeout(() => {
          if (mine !== generation.current) return;
          run(attempt + 1);
        }, checkBackoffMs(attempt));
      });
    },
    [id, check],
  );

  useEffect(() => {
    // A malformed id never reaches the network (design: no request for a bad
    // id), so there is nothing to run and nothing to retry.
    if (!enabled) return;
    generation.current += 1;
    setState('checking');
    setAttempts(0);
    run(0);
    return () => {
      // Invalidate anything in flight, then take the timer down with it.
      generation.current += 1;
      clearTimer();
    };
  }, [run, enabled]);

  return { state, attempts };
}
