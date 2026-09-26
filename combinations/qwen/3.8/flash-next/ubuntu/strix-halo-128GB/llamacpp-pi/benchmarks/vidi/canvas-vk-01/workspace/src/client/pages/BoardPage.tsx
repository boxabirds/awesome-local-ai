import { useEffect, useState, useRef, type JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { checkBoard } from '../api';
import { BoardApp } from '../App';
import { NotFoundPage } from './NotFoundPage';

/**
 * Board page: checks existence, then shows the board, not-found, or unreachable.
 *
 * States: NotFound (malformed id) | Checking | Ready | NotFound | Unreachable
 */
export function BoardPage({ id }: { id: string }): JSX.Element {
  // Malformed id → not found immediately, no request sent
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }

  return <BoardPageInner id={id} />;
}

type PageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

function BoardPageInner({ id }: { id: string }): JSX.Element {
  const [state, setState] = useState<PageState>('checking');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    attemptRef.current = 0;

    const check = async (): Promise<void> => {
      const result = await checkBoard(id);
      if (!mountedRef.current) return;

      if (result.kind === 'exists') {
        setState('ready');
        return;
      }
      if (result.kind === 'not_found') {
        setState('not_found');
        return;
      }
      // unreachable: retry with exponential backoff
      setState('unreachable');
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attemptRef.current),
        RECONNECT_MAX_BACKOFF_MS,
      );
      attemptRef.current += 1;
      timerRef.current = setTimeout(check, delay);
    };

    void check();

    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id]);

  if (state === 'checking') {
    return <div className="board-loading">Opening board…</div>;
  }
  if (state === 'not_found') {
    return <NotFoundPage />;
  }
  if (state === 'unreachable') {
    return <div className="board-loading">Couldn't reach vidi6. Retrying…</div>;
  }

  // Ready: mount the board (which includes the SharePanel internally)
  return <BoardApp boardId={id} />;
}
