// The page a board link opens. It does not connect to a board it has not been
// told exists, and it does not tell a visitor their board is gone because the
// server had a bad minute: 'exists' renders the board, 'missing' renders the
// not-found page, and anything else keeps asking, with waits that grow (PRD
// share.not_found, PRD live.load_retry).
import { useCallback, useEffect, useRef, useState } from 'react';
import BoardApp from '../board/BoardApp.tsx';
import {
  checkBoardRequest,
  type BoardCheckResult,
  type CreateBoardResult,
} from '../api.ts';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config.ts';
import type { ProviderFactory } from '../collab/connectBoard.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

/** Where this page is. `waiting` is the server having not answered clearly. */
export type BoardPageState = 'checking' | 'ready' | 'not_found' | 'waiting';

/**
 * How long to wait before check number `attempt` (1-based). The first failure is
 * waited out for a second, and the waits grow to the same ceiling the socket
 * reconnect uses, so a board that takes a minute to come back is checked at a rate
 * a server can live with.
 */
export function checkRetryDelayMs(
  attempt: number,
  baseMs: number = BOARD_CHECK_RETRY_BASE_MS,
  capMs: number = RECONNECT_MAX_BACKOFF_MS,
): number {
  if (attempt < 1) return baseMs;
  return Math.min(baseMs * 2 ** (attempt - 1), capMs);
}

export interface BoardPageProps {
  boardId: string;
  makeProvider?: ProviderFactory;
  /** How a link is checked. Tests answer without a network. */
  check?: (boardId: string) => Promise<BoardCheckResult>;
  /** How the not-found page asks for a board of its own. */
  createRequest?: () => Promise<CreateBoardResult>;
}

export default function BoardPage({ boardId, makeProvider, check, createRequest }: BoardPageProps) {
  const [state, setState] = useState<BoardPageState>('checking');
  // Which check this page is on, for the delay, and the retry that is pending.
  // Both are refs because a check that is in flight must not be duplicated by a
  // re-render, and a page must never hold two retries at once.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCheck = useCallback(() => {
    const checkBoard = check ?? checkBoardRequest;
    void checkBoard(boardId).then(
      (result) => {
        if (result.kind === 'exists') {
          attempt.current = 0;
          setState('ready');
          return;
        }
        if (result.kind === 'missing') {
          // A clear no. This page stops asking: a page that retried a 404 into
          // rendering would be the same page claiming a board was there.
          setState('not_found');
          return;
        }
        scheduleRetry();
      },
      () => {
        // A check that throws is the same as a check that did not answer.
        scheduleRetry();
      },
    );
  }, [boardId, check]);

  const scheduleRetry = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    // The visitor is told the link is still being checked: the page is not done,
    // and nothing about the board has been concluded.
    setState('waiting');
    const wait = checkRetryDelayMs(attempt.current + 1);
    attempt.current += 1;
    timer.current = setTimeout(runCheck, wait);
  }, [runCheck]);

  useEffect(() => {
    attempt.current = 0;
    runCheck();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    // `boardId` is in `runCheck`'s identity, so a new code re-checks from scratch.
  }, [runCheck]);

  if (state === 'ready') {
    return <BoardApp boardId={boardId} makeProvider={makeProvider} />;
  }

  if (state === 'not_found') {
    return <NotFoundPage createRequest={createRequest} />;
  }

  return (
    <div
      className="board-checking"
      role="status"
      data-state={state}
      data-testid="board-checking"
    >
      {state === 'checking' ? 'Opening board…' : "Couldn't reach vidi6. Retrying…"}
    </div>
  );
}
