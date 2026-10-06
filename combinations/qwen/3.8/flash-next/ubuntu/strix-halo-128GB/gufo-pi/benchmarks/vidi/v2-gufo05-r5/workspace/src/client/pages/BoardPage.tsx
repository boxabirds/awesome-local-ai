/**
 * Board page: checks board existence, then shows the board, not-found, or unreachable state.
 *
 * - Malformed id (fails BOARD_ID_PATTERN) → NotFoundPage immediately, no request.
 * - Valid id → "Opening board…" → checkBoard → ready/not_found/unreachable.
 * - Unreachable: retries with exponential backoff from BOARD_CHECK_RETRY_BASE_MS.
 * - Ready: mounts stories 1–4 board UI + SharePanel.
 */
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { Board } from '../Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import type { BoardPageState } from './state';

export function BoardPage(props: { id: string }): JSX.Element {
  // Malformed id: show not found immediately, no request
  if (!isValidBoardId(props.id)) {
    return <NotFoundPage />;
  }

  return <BoardPageInner id={props.id} />;
}

function BoardPageInner(props: { id: string }) {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doCheck = useCallback(async (attempt: number) => {
    const result = await checkBoard(props.id);
    if (result.kind === 'exists') {
      setState({ kind: 'ready', boardId: props.id });
    } else if (result.kind === 'not_found') {
      setState({ kind: 'not_found' });
    } else {
      // unreachable: schedule retry with exponential backoff
      const nextRetryMs = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt),
        RECONNECT_MAX_BACKOFF_MS,
      );
      setState({ kind: 'unreachable', attempt: attempt + 1, nextRetryMs });
      timerRef.current = setTimeout(() => doCheck(attempt + 1), nextRetryMs);
    }
  }, [props.id]);

  useEffect(() => {
    doCheck(0);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [doCheck]);

  switch (state.kind) {
    case 'checking':
      return <div className="board-loading">Opening board…</div>;
    case 'ready':
      return (
        <>
          <Board boardId={state.boardId} />
          <SharePanel boardId={state.boardId} />
        </>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return <div className="board-unreachable">Couldn&apos;t reach vidi6. Retrying…</div>;
  }
}
