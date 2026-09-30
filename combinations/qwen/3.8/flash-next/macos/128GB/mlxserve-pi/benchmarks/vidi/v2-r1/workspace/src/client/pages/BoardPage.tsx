import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { Board } from '../board/Board';
import { NotFoundPage } from './NotFoundPage';
import { CHECKING_COPY, UNREACHABLE_COPY, nextBoardPageState, type BoardPageState } from './state';

/**
 * The page behind a board link. Before it opens anything it asks whether the
 * board is there, and it opens the board only once that is answered yes
 * (share.open_link, share.not_found). Three things can come of the ask:
 *
 *   - the board is there      -> open it (the stories 1–4 UI, full editing)
 *   - it is definitely absent  -> Board not found (and nothing is created)
 *   - the service can't answer -> "Couldn't reach vidi6. Retrying…" and try again
 *
 * A malformed code never even asks: it is not a board, so it is answered on the
 * spot with Board not found and no request goes out (share.not_found, TC-19).
 * While the service is unreachable the page backs off and retries until it can
 * resolve to ready or not_found on its own, with no reload (share.unreachable).
 */

export function BoardPage({ id }: { id: string }): ReactNode {
  // A code that could never be a board is settled before any request.
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  const attempt = useRef(0);

  useEffect(() => {
    if (state.kind === 'checking') {
      attempt.current += 1;
      const thisAttempt = attempt.current;
      let cancelled = false;
      checkBoard(id).then((result) => {
        if (!cancelled) setState(nextBoardPageState(state, result, thisAttempt, id));
      });
      return () => {
        cancelled = true;
      };
    }
    if (state.kind === 'unreachable') {
      const timer = setTimeout(() => setState({ kind: 'checking' }), state.nextRetryMs);
      return () => clearTimeout(timer);
    }
    // ready and not_found are terminal: nothing to schedule.
    return undefined;
  }, [state, id]);

  switch (state.kind) {
    case 'checking':
      return <Notice testId="board-checking" text={CHECKING_COPY} />;
    case 'unreachable':
      return <Notice testId="board-unreachable" text={UNREACHABLE_COPY} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'ready':
      return <Board boardId={id} />;
  }
}

/** A full-screen line while the board is being checked or waited on. */
function Notice({ testId, text }: { testId: string; text: string }): ReactNode {
  const style: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    opacity: 0.8,
  };
  return (
    <main data-testid={testId} role="status" style={style}>
      {text}
    </main>
  );
}
