// Story 5: board page (share.pages). For a well-formed id it checks existence
// (GET /api/boards/<id>) before mounting the board: 200 -> Ready (mount the
// board + connect the socket), 404 -> NotFound, network/5xx -> Unreachable
// which retries on an exponential backoff starting at BOARD_CHECK_RETRY_BASE_MS
// (capped at RECONNECT_MAX_BACKOFF_MS). An id that fails the pattern renders
// the not-found page WITHOUT any request (share.pages).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { Board } from '../App';
import { SharePanel } from '../share/SharePanel';
import { checkBoard, type BoardCheckResult } from '../api';
import { NotFoundPage } from './NotFoundPage';

type BoardStatus = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage(props: { id: string }): JSX.Element {
  // An invalid id never reaches the server (no request is sent).
  if (!isValidBoardId(props.id)) {
    return <NotFoundPage />;
  }
  return <BoardPageInner id={props.id} />;
}

function BoardPageInner(props: { id: string }): JSX.Element {
  const [status, setStatus] = useState<BoardStatus>('checking');
  const timer = useRef<number | null>(null);
  const backoff = useRef(BOARD_CHECK_RETRY_BASE_MS);
  const alive = useRef(true);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const runCheck = useCallback((): void => {
    void checkBoard(props.id).then((result: BoardCheckResult) => {
      if (!alive.current) return;
      if (result.kind === 'exists') {
        clearTimer();
        backoff.current = BOARD_CHECK_RETRY_BASE_MS;
        setStatus('ready');
      } else if (result.kind === 'not_found') {
        clearTimer();
        setStatus('not_found');
      } else {
        // Unreachable: keep retrying on the backoff timer.
        setStatus('unreachable');
        const delay = backoff.current;
        backoff.current = Math.min(delay * 2, RECONNECT_MAX_BACKOFF_MS);
        clearTimer();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          runCheck();
        }, delay);
      }
    });
  }, [props.id, clearTimer]);

  useEffect(() => {
    alive.current = true;
    backoff.current = BOARD_CHECK_RETRY_BASE_MS;
    runCheck();
    return () => {
      alive.current = false;
      clearTimer();
    };
  }, [runCheck, clearTimer]);

  if (status === 'not_found') {
    return <NotFoundPage />;
  }
  if (status === 'checking' || status === 'unreachable') {
    return (
      <div className="page page--center" aria-busy="true">
        <p className="page-loading">
          {status === 'checking'
            ? 'Opening board…'
            : "Couldn't reach vidi6. Retrying…"}
        </p>
      </div>
    );
  }
  // Board renders its own .app-root; the Share panel is fixed-positioned.
  return (
    <>
      <Board boardId={props.id} />
      <SharePanel boardId={props.id} />
    </>
  );
}
