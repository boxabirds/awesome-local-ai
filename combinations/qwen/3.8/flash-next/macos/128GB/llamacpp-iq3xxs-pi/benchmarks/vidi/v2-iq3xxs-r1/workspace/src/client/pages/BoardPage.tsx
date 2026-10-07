import { useEffect, useState } from 'react';
import { checkBoard } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { Board } from '../board/Board';
import { NotFoundPage } from './NotFoundPage';
import {
  boardCheckRetryMs,
  nextBoardPageState,
  OPENING_BOARD_MESSAGE,
  UNREACHABLE_MESSAGE,
  type BoardPageState,
} from './state';

/**
 * The board page (PRD share.open_link): the link is checked first, and only then is a
 * board rendered — so a socket is never opened at a board that does not exist, and an
 * empty board never appears where a missing one should be reported.
 *
 * The check itself asks the server the one question it can answer ("does your storage
 * hold this board?"), and nothing else: a request that read the board's content would
 * hand back a stranger's notes before this page had even decided what to show.
 */
export function BoardPage({ boardId }: { readonly boardId: string }) {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });

  useEffect(() => {
    // An address that cannot name a board is answered here, without a request: the
    // Worker applies the same rule to its routes, and a made-up address must not be
    // able to summon a room (TC-07, TC-22).
    if (!isValidBoardId(boardId)) {
      setState({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** Ask once, then act on the answer; a retry is scheduled only when asked for. */
    const ask = async (current: BoardPageState): Promise<void> => {
      const result = await checkBoard(boardId);
      if (cancelled) return;
      const attempt = current.kind === 'unreachable' ? current.attempt : 0;
      const next = nextBoardPageState(current, result, attempt, boardId);
      setState(next);
      if (next.kind === 'unreachable') {
        timer = setTimeout(() => void ask(next), next.nextRetryMs);
      }
    };
    void ask({ kind: 'checking' });

    return () => {
      // Leaving a board (back button, a new board) stops the checking, and any
      // retry that was already scheduled (design "Cleanup").
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [boardId]);

  switch (state.kind) {
    case 'ready':
      return <Board boardId={state.boardId} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <main className="page" data-testid="board-page-unreachable">
          <p className="page-status" role="status">
            {UNREACHABLE_MESSAGE}
          </p>
          <p className="page-note">
            {/* The wait is shown so a person knows the page is still working (TC-21). */}
            {`Retrying in ${boardCheckRetryMs(state.attempt) / 1000}s.`}
          </p>
        </main>
      );
    case 'checking':
      return (
        <main className="page" data-testid="board-page-checking">
          <p className="page-status" role="status">
            {OPENING_BOARD_MESSAGE}
          </p>
        </main>
      );
  }
}
