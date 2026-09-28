import { useEffect, useState, useRef } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { checkBoard } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { BoardApp } from '../BoardApp';
import { SharePanel } from '../share/SharePanel';

type BoardPageState = 'checking' | 'not_found' | 'unreachable' | 'ready';

export function BoardPage({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) return 'not_found';
    return 'checking';
  });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(BOARD_CHECK_RETRY_BASE_MS);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!isValidBoardId(id)) {
      setState('not_found');
      return;
    }

    unmountedRef.current = false;
    backoffRef.current = BOARD_CHECK_RETRY_BASE_MS;

    async function doCheck() {
      if (unmountedRef.current) return;
      const result = await checkBoard(id);
      if (unmountedRef.current) return;

      if (result.kind === 'exists') {
        setState('ready');
      } else if (result.kind === 'not_found') {
        setState('not_found');
      } else {
        setState('unreachable');
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_BACKOFF_MS);
        retryTimer.current = setTimeout(doCheck, delay);
      }
    }

    doCheck();

    return () => {
      unmountedRef.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [id]);

  if (state === 'checking') {
    return <div data-testid="board-loading">Opening board…</div>;
  }

  if (state === 'unreachable') {
    return <div data-testid="board-unreachable">Couldn't reach vidi6. Retrying…</div>;
  }

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  return (
    <div className="board-page">
      <SharePanel boardId={id} />
      <BoardApp boardId={id} />
    </div>
  );
}
