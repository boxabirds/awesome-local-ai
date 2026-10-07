/**
 * Board page — existence check → board (stories 1–4 UI) / not found / unreachable.
 * Story 5 — share a board with others using a link.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { navigate } from '../router';
import { checkBoard } from '../api';
import { isValidBoardId } from '@/shared/board-id';
import type { CheckResponse } from '../api';
import type { BoardPageState } from './state';
import { nextBoardPageState } from './state';
import { BoardRoot } from '../board/BoardRoot';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';

export function BoardPage(props: { id: string }): ReactNode {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  // Cancel any pending retry timer on unmount or prop change
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTimer();
    attemptRef.current = 0;

    // Malformed id → not found immediately, no request
    if (!isValidBoardId(props.id)) {
      setState({ kind: 'not_found' });
      return;
    }

    // Start checking
    doCheck();
  }, [props.id, clearTimer]);

  async function doCheck() {
    const result: CheckResponse = await checkBoard(props.id);
    const nextState = nextBoardPageState(state, result, attemptRef.current);

    if (nextState.kind === 'ready') {
      setState(nextState);
    } else if (nextState.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else if (nextState.kind === 'unreachable') {
      setState((current) => ({
        ...nextState,
        // Only update attempt count if current is also unreachable
        ...(current.kind === 'unreachable' ? {} : { attempt: nextState.attempt }),
      }));
      // Schedule retry
      timerRef.current = setTimeout(doCheck, nextState.nextRetryMs);
    } else if (nextState.kind === 'checking') {
      setState({ kind: 'checking' });
    }
  }

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  // ── Render states ────────────────────────────────────────────────

  if (state.kind === 'not_found') {
    return <NotFoundPage onCreateBoard={() => navigate('/')} />;
  }

  if (state.kind === 'unreachable') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#6c757d',
        fontSize: '1.1rem',
      }}>
        Couldn&apos;t reach vidi6. Retrying…
      </div>
    );
  }

  if (state.kind === 'checking') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#6c757d',
        fontSize: '1.1rem',
      }}>
        Opening board…
      </div>
    );
  }

  // state.kind === 'ready' → render board + Share panel
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <SharePanel boardId={state.boardId} />
      <BoardRoot boardId={state.boardId} />
    </div>
  );
}
