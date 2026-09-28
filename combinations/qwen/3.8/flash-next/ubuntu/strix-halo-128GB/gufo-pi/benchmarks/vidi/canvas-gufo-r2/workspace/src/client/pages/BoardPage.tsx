/**
 * Board page: existence check with retry, then render the board UI (stories 1–4)
 * or Board not found, or Unreachable message.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { App } from '../App';
import { NotFoundPage } from './NotFoundPage';

type BoardPageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage(props: { id: string }) {
  const [state, setBoardState] = useState<BoardPageState>(() => {
    if (!isValidBoardId(props.id)) return 'not_found';
    return 'checking';
  });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(BOARD_CHECK_RETRY_BASE_MS);
  const mounted = useRef(true);

  const doCheck = useCallback(async () => {
    if (!isValidBoardId(props.id)) {
      setBoardState('not_found');
      return;
    }

    setBoardState('checking');
    retryDelay.current = BOARD_CHECK_RETRY_BASE_MS;

    const check = async () => {
      if (!mounted.current) return;
      const result = await checkBoard(props.id);
      if (!mounted.current) return;

      if (result.kind === 'exists') {
        setBoardState('ready');
      } else if (result.kind === 'not_found') {
        setBoardState('not_found');
      } else {
        // unreachable: schedule retry with exponential backoff
        setBoardState('unreachable');
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 2, RECONNECT_MAX_BACKOFF_MS);
        retryTimer.current = setTimeout(check, delay);
      }
    };

    await check();
  }, [props.id]);

  useEffect(() => {
    mounted.current = true;
    doCheck();
    return () => {
      mounted.current = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [doCheck]);

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'checking') {
    return <div className="board-page"><p>Opening board…</p></div>;
  }

  if (state === 'unreachable') {
    return <div className="board-page"><p>Couldn't reach vidi6. Retrying…</p></div>;
  }

  // Ready: mount the board UI from stories 1–4
  return <App />;
}
