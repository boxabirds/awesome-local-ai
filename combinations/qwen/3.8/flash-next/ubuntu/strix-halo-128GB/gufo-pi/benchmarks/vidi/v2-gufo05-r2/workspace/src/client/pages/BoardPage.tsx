/**
 * The board page: find out whether this address is one of ours, then show the board
 * (share.board_page, share.not_found, share.unreachable).
 *
 * The check happens before the socket is opened, and the states are the four that a
 * person can be in while it is happening: asking, on the board, told it does not
 * exist, and unable to ask. There is no fifth state for "probably broken", because
 * the server answers this question out of its own storage: 404 means nobody created
 * this board, which is a fact and not a guess.
 *
 * What the check is protecting: before story 5 any address became a board, so a
 * mistyped link was a silent empty board — worse than an error, because it looks
 * like the board was emptied. The cost is one small request before the board, which
 * the skeleton covers.
 */

import { useEffect, useState } from 'react';

import { isValidBoardId } from '../../shared/board-id';
import { BoardSurface } from '../board/BoardSurface';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { boardCheckDelayMs, nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';

export function BoardPage({ boardId }: { boardId: string }) {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(boardId) ? { kind: 'checking' } : { kind: 'not_found' },
  );
  // Bumped by "Retry now": the effect starts the asking again from the first,
  // shortest wait, because a person who asks again has restarted the question.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isValidBoardId(boardId)) {
      // Not a link code at all, so not a board of ours — and asking would be
      // naming something to look up that we already know cannot be there.
      setState({ kind: 'not_found' });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const ask = async (): Promise<void> => {
      attempt += 1;
      const result = await checkBoard(boardId);
      if (cancelled) return;
      setState((current) => nextBoardPageState(current, result, attempt, boardId));
      if (result.kind === 'unreachable') {
        // It asks again on its own: a service that is coming back should not need
        // a person to press a button every time it blinks (share.unreachable).
        timer = setTimeout(() => void ask(), boardCheckDelayMs(attempt));
      }
    };
    void ask();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [boardId, retryNonce]);

  if (state.kind === 'ready') {
    return (
      <>
        {/* `key` on the page (App) already keeps two boards apart; the panel is per
            board too, so the link it shows can never be another board's. */}
        <BoardSurface boardId={state.boardId} />
        <SharePanel boardId={state.boardId} />
      </>
    );
  }

  if (state.kind === 'not_found') return <NotFoundPage />;

  const unreachable = state.kind === 'unreachable';
  return (
    <div className="vidi6-app board-pending">
      <div
        className="board-loading"
        role="status"
        data-testid={unreachable ? 'board-unreachable' : 'board-opening'}
      >
        <span className="board-loading-spinner" aria-hidden="true" />
        <p className="board-loading-message">
          {unreachable ? "Couldn't reach vidi6. Retrying…" : 'Opening board…'}
        </p>
        {unreachable && (
          <>
            <p className="board-loading-detail">
              Attempt {state.attempt}. It asks again in {Math.round(state.nextRetryMs / 1000)}s.
            </p>
            <button
              type="button"
              className="board-retry"
              data-testid="board-retry"
              onClick={() => setRetryNonce((nonce) => nonce + 1)}
            >
              Retry now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
