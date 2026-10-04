/**
 * Board page: existence check → board (stories 1–4 UI) / not found / unreachable.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { BoardContent } from './BoardContent';
import type { BoardPageState } from './state';

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;

  // Malformed id → not found immediately (no request)
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }

  return <BoardPageInner id={id} />;
}

function BoardPageInner({ id }: { id: string }): JSX.Element {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const doCheck = useCallback(async () => {
    const result = await checkBoard(id);
    if (!mountedRef.current) return;

    attemptRef.current += 1;

    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId: id });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable: schedule retry with exponential backoff
      const attempt = attemptRef.current;
      const nextRetryMs = Math.min(
        1000 * Math.pow(2, attempt - 1),
        10000,
      );
      setState({ kind: 'unreachable', attempt, nextRetryMs });
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) doCheck();
      }, nextRetryMs);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    doCheck();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [doCheck]);

  switch (state.kind) {
    case 'checking':
      return (
        <div className="board-loading" data-vidi6="board-loading">
          Opening board…
        </div>
      );
    case 'ready':
      return <BoardContent boardId={id} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div className="board-unreachable" data-vidi6="board-unreachable">
          Couldn't reach vidi6. Retrying…
        </div>
      );
  }
}
