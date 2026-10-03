// Board page: existence check with retry, then renders the board UI.

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { NotFoundPage } from './NotFoundPage';
import { BoardContent } from '../board/BoardContent';
import { SharePanel } from '../share/SharePanel';
import type { BoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  // If the id is malformed, go straight to not_found (no request).
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) return { kind: 'not_found' };
    return { kind: 'checking' };
  });
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const doCheck = useCallback(async (att: number) => {
    const result = await checkBoard(id);
    if (unmountedRef.current) return;

    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId: id });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable: compute backoff and retry
      const backoff = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, att - 1),
        RECONNECT_MAX_BACKOFF_MS,
      );
      setState({ kind: 'unreachable', attempt: att, nextRetryMs: backoff });
      if (!unmountedRef.current) {
        timerRef.current = setTimeout(() => {
          const next = att + 1;
          setAttempt(next);
          doCheck(next);
        }, backoff);
      }
    }
  }, [id]);

  useEffect(() => {
    unmountedRef.current = false;
    if (isValidBoardId(id)) {
      setAttempt(1);
      doCheck(1);
    }
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id, doCheck]);

  // Render based on state
  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <div className="board-loading" data-testid="board-loading">
        Opening board…
      </div>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <div className="board-unreachable" data-testid="board-unreachable">
        Couldn't reach vidi6. Retrying…
      </div>
    );
  }

  // state.kind === 'ready'
  return (
    <div className="board-page" data-testid="board-page">
      <BoardContent boardId={id} />
      <SharePanel boardId={id} />
    </div>
  );
}
