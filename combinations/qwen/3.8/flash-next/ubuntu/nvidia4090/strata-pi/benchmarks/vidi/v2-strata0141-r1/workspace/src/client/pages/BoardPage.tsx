import { useEffect, useRef, useState } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import { BoardView } from '../board/BoardView';
import { SharePanel } from '../share/SharePanel';
import { checkBoard } from '../api';
import {
  UNREACHABLE_MESSAGE,
  OPENING_MESSAGE,
  initialBoardPageState,
  nextBoardPageState,
  type BoardPageState,
} from './state';
import { NotFoundPage } from './NotFoundPage';

/**
 * The board page (`share.open_link`).
 *
 * It answers one question before it shows anything: does the board this address
 * names exist? The answer comes from the server, because only the server knows
 * (`share.board_api`). While that is unsettled the page says so plainly rather
 * than showing a board that might not be there.
 *
 *   Opening board…                        the check is in flight
 *   Couldn't reach vidi6. Retrying…       the service did not answer; retried with
 *                                         delay (1s, 2s, 4s, capped at 8s) forever,
 *                                         because a board that exists will come back
 *   Board not found                       the server says there is nothing here, or
 *                                         the address is not a board address at all -
 *                                         a malformed id never even asks (TC-19)
 *   the board + Share                     the board exists
 */
export function BoardPage({ boardId }: { boardId: string }) {
  const [state, setState] = useState<BoardPageState>(() => initialBoardPageState(boardId));
  const attemptRef = useRef(0);

  useEffect(() => {
    // A board that does not exist is still refused, but only after the server was
    // asked; a malformed id cannot name a board, so asking would be noise.
    if (!isValidBoardId(boardId)) {
      setState({ kind: 'not_found' });
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    attemptRef.current = 0;

    const check = async (): Promise<void> => {
      const result = await checkBoard(boardId);
      if (cancelled) {
        return;
      }
      attemptRef.current += 1;
      const next = nextBoardPageState(boardId, result, attemptRef.current);
      setState(next);
      if (next.kind === 'unreachable') {
        // Read-only, so trying again is safe; a 404 is never retried.
        timer = setTimeout(() => {
          void check();
        }, next.nextRetryMs);
      }
    };

    void check();
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [boardId]);

  if (state.kind === 'not_found') {
    return <NotFoundPage />;
  }

  if (state.kind === 'checking') {
    return (
      <main className="page page--checking" data-testid="board-checking" data-check-state="checking">
        <h1 className="page__title">{OPENING_MESSAGE}</h1>
      </main>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <main
        className="page page--checking"
        data-testid="board-checking"
        data-check-state="unreachable"
        data-attempt={state.attempt}
      >
        <h1 className="page__title">{OPENING_MESSAGE}</h1>
        <p className="page__error" role="status">
          {UNREACHABLE_MESSAGE}
        </p>
      </main>
    );
  }

  return (
    <>
      <BoardView boardId={state.boardId} />
      <SharePanel boardId={state.boardId} />
    </>
  );
}
