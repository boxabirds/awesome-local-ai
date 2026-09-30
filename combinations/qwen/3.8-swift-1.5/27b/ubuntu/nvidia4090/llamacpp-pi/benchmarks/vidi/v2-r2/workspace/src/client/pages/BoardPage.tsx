import { useEffect, useRef, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

/**
 * /b/:id (story 5): checks the board's existence before rendering the
 * board UI.
 *
 *   exists      → ready (board UI + share panel)
 *   404         → "Board not found" page
 *   network/5xx → "Couldn't reach vidi6. Retrying…" with a doubling
 *                 backoff (1s, 2s, 4s, …) until it succeeds — no reload,
 *                 the user sees exactly what they should see.
 *
 * Malformed ids skip the request entirely (the server would 404 them) and
 * go straight to the not-found page.
 */
export function BoardPage({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' }
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isValidBoardId(id)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const runCheck = () => {
      attempt += 1;
      const n = attempt;
      void checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState(id, stateRef.current, result, n);
        stateRef.current = next;
        setState(next);
        if (next.kind === 'unreachable') {
          timer = setTimeout(runCheck, next.nextRetryMs);
        }
      });
    };

    runCheck();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  switch (state.kind) {
    case 'not_found':
      return <NotFoundPage />;
    case 'checking':
      return <PageMessage>Opening board…</PageMessage>;
    case 'unreachable':
      return <PageMessage>Couldn't reach vidi6. Retrying…</PageMessage>;
    case 'ready':
      return (
        <>
          <Board boardId={id} />
          <SharePanel boardId={id} />
        </>
      );
  }
}

function PageMessage({ children }: { children: string }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 16,
        color: '#475569',
        background: '#F8FAFC',
      }}
    >
      {children}
    </div>
  );
}
