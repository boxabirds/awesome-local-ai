/**
 * Board page (story 5): checks that the board in the link exists, then
 * renders it — or the not-found page, or the unreachable/retrying state.
 *
 * - `checking`: "Opening board…" (no socket is opened yet; the check is the
 *   only network call for a fresh browser on an old link).
 * - `not_found`: the Board not found page (share.not_found).
 * - `unreachable`: "Couldn't reach vidi6. Retrying…" with exponential
 *   backoff (share.unreachable) until the service answers.
 * - `ready`: the board (story 1) plus the Share panel (share.copy).
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

export function BoardPage({ id }: { id: string }): JSX.Element {
  // Malformed ids never reach the service (share.not_found, TC-19).
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardChecker id={id} />;
}

function BoardChecker({ id }: { id: string }): JSX.Element {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = (attempt: number): void => {
      void (async () => {
        const result = await checkBoard(id);
        if (cancelled) {
          return;
        }
        const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
        setState(next);
        if (next.kind === 'unreachable') {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            void run(attempt + 1);
          }, next.nextRetryMs);
        }
      })();
    };

    run(1);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id]);

  switch (state.kind) {
    case 'checking':
      return (
        <div
          data-testid="board-loading"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8f8f6',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Opening board…
        </div>
      );
    case 'unreachable':
      return (
        <div
          data-testid="board-unreachable"
          role="alert"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8f8f6',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return (
        <>
          <Board boardId={id} />
          <SharePanel boardId={id} />
        </>
      );
  }
}
