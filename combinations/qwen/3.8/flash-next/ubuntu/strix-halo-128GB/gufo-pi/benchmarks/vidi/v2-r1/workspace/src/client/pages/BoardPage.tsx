/**
 * Board page: checks board existence, then renders the board (stories 1–4 UI)
 * or shows "Board not found" / "Couldn't reach vidi6. Retrying…".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { App } from '../App';
import { NotFoundPage } from './NotFoundPage';
import type { BoardPageState } from './state';
import { nextBoardPageState } from './state';

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) return { kind: 'not_found' };
    return { kind: 'checking' };
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const doCheck = useCallback(async () => {
    if (!isValidBoardId(id)) {
      setState({ kind: 'not_found' });
      return;
    }
    setState({ kind: 'checking' });
    const result = await checkBoard(id);
    if (!mountedRef.current) return;
    const next = nextBoardPageState(
      { kind: 'checking' },
      result,
      id,
      attemptRef.current,
    );
    setState(next);
    if (next.kind === 'unreachable') {
      attemptRef.current = next.attempt;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (mountedRef.current) doCheck();
      }, next.nextRetryMs);
    }
  }, [id]);

  // Trigger check on mount (if valid id)
  useEffect(() => {
    attemptRef.current = 0;
    if (isValidBoardId(id)) {
      doCheck();
    }
  }, [id, doCheck]);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p data-testid="opening-board">Opening board\u2026</p>
      </div>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p data-testid="unreachable-message">Couldn&apos;t reach vidi6. Retrying\u2026</p>
      </div>
    );
  }

  // state.kind === 'ready': render the board UI (stories 1–4)
  return <App boardId={state.boardId} />;
}
