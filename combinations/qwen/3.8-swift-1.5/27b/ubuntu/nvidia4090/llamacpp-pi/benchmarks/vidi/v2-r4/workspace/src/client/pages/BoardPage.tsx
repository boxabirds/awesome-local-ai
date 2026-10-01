import { useState, useEffect, useRef, useCallback } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { NotFoundPage } from './NotFoundPage';
import { BoardUI } from './BoardUI';
import type { BoardPageState } from './state';
import { nextBoardPageState } from './state';

export function BoardPage({ id }: { id: string }) {
  // If the id is malformed, go straight to not_found without any request
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) {
      return { kind: 'not_found' };
    }
    return { kind: 'checking' };
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const doCheck = useCallback(async (att: number) => {
    const result = await checkBoard(id);
    if (!mountedRef.current) return;
    const next = nextBoardPageState({ kind: 'checking' }, result, att, id);
    setState(next);
    if (next.kind === 'unreachable') {
      timerRef.current = setTimeout(() => {
        doCheck(att + 1);
      }, next.nextRetryMs);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    if (state.kind === 'checking') {
      doCheck(1);
    }
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'unreachable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Couldn't reach vidi6. Retrying…</p>
      </div>
    );
  }

  if (state.kind === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Opening board…</p>
      </div>
    );
  }

  // state.kind === 'ready'
  return <BoardUI boardId={state.boardId} />;
}
