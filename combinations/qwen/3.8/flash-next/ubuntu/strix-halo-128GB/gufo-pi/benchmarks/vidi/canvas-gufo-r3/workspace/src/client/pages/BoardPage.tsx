import React, { useState, useEffect, useRef, useCallback } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '@shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '@shared/config';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { Board } from '../Board';

type BoardPageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }): React.ReactNode {
  // Malformed ids → not found immediately, no request
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }

  return <BoardPageInner id={id} />;
}

function BoardPageInner({ id }: { id: string }): React.ReactNode {
  const [state, setState] = useState<BoardPageState>('checking');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  const doCheck = useCallback(async () => {
    const result = await checkBoard(id);
    if (!mountedRef.current) return;

    if (result.kind === 'exists') {
      setState('ready');
      retryCountRef.current = 0;
    } else if (result.kind === 'not_found') {
      setState('not_found');
    } else {
      // unreachable
      setState('unreachable');
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, retryCountRef.current),
        RECONNECT_MAX_BACKOFF_MS,
      );
      retryCountRef.current++;
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) doCheck();
      }, delay);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;
    doCheck();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [doCheck]);

  if (state === 'checking') {
    return <LoadingMessage text="Opening board…" />;
  }

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'unreachable') {
    return <LoadingMessage text="Couldn't reach vidi6. Retrying…" />;
  }

  // Ready: render the board
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Board boardId={id} />
      <SharePanel boardId={id} />
    </div>
  );
}

function LoadingMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '1.2rem',
        color: '#555',
      }}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
