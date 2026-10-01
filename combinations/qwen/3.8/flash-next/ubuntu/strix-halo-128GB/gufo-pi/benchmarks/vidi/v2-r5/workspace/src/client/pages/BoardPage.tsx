import { useState, useEffect, useRef, useCallback } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import type { BoardPageState } from './state';

export interface BoardPageProps {
  id: string;
}

/**
 * BoardPage: checks board existence, then shows the board, not-found, or unreachable.
 */
export function BoardPage({ id }: BoardPageProps) {
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) return { kind: 'not_found' };
    return { kind: 'checking' };
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  const doCheck = useCallback(async (boardId: string) => {
    attemptRef.current++;
    const result = await checkBoard(boardId);

    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable
      const attempt = attemptRef.current;
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      setState({ kind: 'unreachable', attempt, nextRetryMs });
    }
  }, []);

  useEffect(() => {
    if (!isValidBoardId(id)) {
      setState({ kind: 'not_found' });
      return;
    }

    attemptRef.current = 0;
    doCheck(id);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [id, doCheck]);

  // Retry timer for unreachable state
  useEffect(() => {
    if (state.kind === 'unreachable') {
      timerRef.current = setTimeout(() => {
        doCheck(id);
      }, state.nextRetryMs);
      return () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
      };
    }
  }, [state, id, doCheck]);

  if (state.kind === 'checking') {
    return <div className="board-loading" role="status">{"Opening board…"}</div>;
  }

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'unreachable') {
    return <div className="board-unreachable" role="status">{"Couldn't reach vidi6. Retrying…"}</div>;
  }

  // ready
  return (
    <div className="board-wrapper">
      <App boardId={id} />
      <SharePanel boardId={id} />
    </div>
  );
}
