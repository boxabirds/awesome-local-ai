// src/client/pages/BoardPage.tsx
// Board page: existence check → board UI / not found / unreachable with retry.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import { BoardContent } from './BoardContent';

export function BoardPage(props: { id: string }): ReactElement {
  const { id } = props;
  const [state, setState] = useState<{
    kind: 'checking' | 'ready' | 'not_found' | 'unreachable';
    attempt?: number;
  }>(() => {
    // If id is malformed, go straight to not_found without any request
    if (!isValidBoardId(id)) {
      return { kind: 'not_found' };
    }
    return { kind: 'checking' };
  });

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const doCheck = useCallback(async () => {
    if (unmountedRef.current) return;
    const result = await checkBoard(id);
    if (unmountedRef.current) return;

    if (result.kind === 'exists') {
      setState({ kind: 'ready' });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable - schedule retry with exponential backoff
      attemptRef.current++;
      const attempt = attemptRef.current;
      const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      setState({ kind: 'unreachable', attempt });
      timerRef.current = setTimeout(() => {
        doCheck();
      }, backoff);
    }
  }, [id]);

  useEffect(() => {
    unmountedRef.current = false;
    if (state.kind === 'checking') {
      doCheck();
    }
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle retry from unreachable state
  useEffect(() => {
    if (state.kind === 'unreachable') {
      // The timer is already set in doCheck
    }
  }, [state]);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Opening board…</p>
      </div>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <p>Couldn't reach vidi6. Retrying…</p>
      </div>
    );
  }

  // state.kind === 'ready'
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <BoardContent boardId={id} />
      <SharePanel boardId={id} />
    </div>
  );
}
