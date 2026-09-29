// The board-page entry check (design "Board page entry check"). Opening a link
// must never produce a blank board at an address that is not one: this page asks
// the server whether the board exists, and mounts the real board — with its
// connection — ONLY on a 200. A 404 is the Board Not Found page; anything else
// (offline, 5xx) says so and keeps retrying by itself (share.unreachable).

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api.ts';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config.ts';
import BoardApp from '../board/BoardApp.tsx';
import NotFoundPage from './NotFoundPage.tsx';

const OPENING = 'Opening board…';
const UNREACHABLE = "Couldn't reach vidi6. Retrying…";

type Phase =
  /** The first check is in flight: no canvas, no connection yet (share.not_found). */
  | 'checking'
  /** 200: the board is open. */
  | 'ready'
  /** 404. */
  | 'not-found'
  /** No answer; retrying automatically. */
  | 'unreachable';

/**
 * The delay before the `attempt`th retry (1-based): 1 s, then 2 s, 4 s …, capped
 * at story 3's reconnect ceiling — the doubling must not run away from the visitor
 * who is waiting for the board to appear (share.unreachable).
 */
export function checkRetryDelayMs(attempt: number): number {
  const doubled = BOARD_CHECK_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(doubled, RECONNECT_MAX_BACKOFF_MS);
}

export default function BoardPage({ boardId }: { boardId: string }) {
  const [phase, setPhase] = useState<Phase>('checking');
  // Bumped to start another check right now (the retry button, or the browser
  // coming back online); it also restarts the backoff timer.
  const [checkToken, setCheckToken] = useState(0);
  const attempts = useRef(0);

  const retryNow = useCallback(() => setCheckToken((token) => token + 1), []);

  useEffect(() => {
    // A different board id under the same component is a different link: the
    // previous check's answer must not be reused.
    let current = true;
    setPhase('checking');
    void checkBoard(boardId).then((result) => {
      if (!current) return;
      if (result === 'exists') {
        attempts.current = 0;
        setPhase('ready');
      } else if (result === 'not-found') {
        setPhase('not-found');
      } else {
        attempts.current += 1;
        setPhase('unreachable');
      }
    });
    return () => {
      current = false;
    };
  }, [boardId, checkToken]);

  useEffect(() => {
    if (phase !== 'unreachable') return;
    // The retry is automatic — the visitor never has to reload (share.unreachable).
    const timer = setTimeout(retryNow, checkRetryDelayMs(attempts.current));
    // Coming back online is worth an immediate check rather than waiting it out.
    const onOnline = () => retryNow();
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [phase, checkToken, retryNow]);

  if (phase === 'ready') return <BoardApp boardId={boardId} />;

  if (phase === 'not-found') return <NotFoundPage boardId={boardId} />;

  return (
    <main className="board-checking" data-testid="board-check">
      {phase === 'checking' ? (
        <p role="status" data-testid="board-opening">
          {OPENING}
        </p>
      ) : (
        <div className="board-checking-unreachable">
          <p role="alert" data-testid="board-unreachable">
            {UNREACHABLE}
          </p>
          <button type="button" onClick={retryNow} data-testid="board-check-retry">
            Try again
          </button>
        </div>
      )}
    </main>
  );
}
