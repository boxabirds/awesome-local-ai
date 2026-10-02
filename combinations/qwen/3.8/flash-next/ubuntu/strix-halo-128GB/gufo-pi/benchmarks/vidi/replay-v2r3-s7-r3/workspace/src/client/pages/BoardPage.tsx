import React, { useEffect, useState, useRef, useCallback } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { BoardUI } from '../App';

type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

export function BoardPage(props: { id: string }): React.JSX.Element {
  const { id } = props;
  const [state, setState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(id)) return { kind: 'not_found' };
    return { kind: 'checking' };
  });

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const doCheck = useCallback(async (boardId: string) => {
    const result: CheckResponse = await checkBoard(boardId);
    if (!mountedRef.current) return;

    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attemptRef.current),
        RECONNECT_MAX_BACKOFF_MS,
      );
      attemptRef.current += 1;
      setState({ kind: 'unreachable', attempt: attemptRef.current, nextRetryMs });
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) doCheck(boardId);
      }, nextRetryMs);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    attemptRef.current = 0;

    if (isValidBoardId(id)) {
      setState({ kind: 'checking' });
      doCheck(id);
    } else {
      setState({ kind: 'not_found' });
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id, doCheck]);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Opening board…</p>
      </div>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Couldn't reach vidi6. Retrying…</p>
      </div>
    );
  }

  // state.kind === 'ready'
  return <BoardReady boardId={state.boardId} />;
}

function BoardReady({ boardId }: { boardId: string }): React.JSX.Element {
  return (
    <>
      <BoardUI boardId={boardId} />
      <SharePanel boardId={boardId} />
    </>
  );
}
